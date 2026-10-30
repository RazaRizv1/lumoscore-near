// AWS Signature Version 4 for plain GETs, with Web Crypto -- enough to read NEAR Lake
// (s3://near-lake-data-mainnet, eu-central-1, requester pays) from a Worker without an SDK.
// Checked against AWS's own documented example (scripts/sigv4-test.mjs).

const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
async function sha256(s) { return hex(await crypto.subtle.digest('SHA-256', typeof s === 'string' ? enc.encode(s) : s)); }
async function hmac(key, msg) {
  const k = await crypto.subtle.importKey('raw', typeof key === 'string' ? enc.encode(key) : key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', k, enc.encode(msg));
}
// RFC 3986, as AWS wants it: everything but A-Z a-z 0-9 - _ . ~ is escaped (and '/' kept in paths).
const uri = (s, keepSlash) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())
  .replace(keepSlash ? /%2F/g : /$^/, '/');

// Signs a request; returns the headers to send. `query` is an object of raw values.
export async function sign({ method, host, path, query, headers, region, service, accessKey, secretKey, amzDate, body }) {
  const date = amzDate.slice(0, 8);
  const payloadHash = await sha256(body || '');
  const h = Object.assign({}, headers || {}, { host, 'x-amz-date': amzDate });
  if (service === 's3') h['x-amz-content-sha256'] = payloadHash;
  const names = Object.keys(h).map((k) => k.toLowerCase()).sort();
  const lower = {}; Object.keys(h).forEach((k) => { lower[k.toLowerCase()] = String(h[k]).trim().replace(/\s+/g, ' '); });
  const canonHeaders = names.map((k) => k + ':' + lower[k] + '\n').join('');
  const signed = names.join(';');
  const qs = Object.keys(query || {}).sort().map((k) => uri(k) + '=' + uri(String(query[k]))).join('&');
  const canon = [method, uri(path, true), qs, canonHeaders, signed, payloadHash].join('\n');
  const scope = date + '/' + region + '/' + service + '/aws4_request';
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, await sha256(canon)].join('\n');
  let k = await hmac('AWS4' + secretKey, date);
  k = await hmac(k, region); k = await hmac(k, service); k = await hmac(k, 'aws4_request');
  const sig = hex(await hmac(k, toSign));
  const out = Object.assign({}, h, { authorization: 'AWS4-HMAC-SHA256 Credential=' + accessKey + '/' + scope + ', SignedHeaders=' + signed + ', Signature=' + sig });
  delete out.host;
  return { headers: out, signature: sig };
}

export const LAKE = { bucket: 'near-lake-data-mainnet', region: 'eu-central-1' };
const HOST = LAKE.bucket + '.s3.' + LAKE.region + '.amazonaws.com';
const amzNow = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

async function lakeFetch(env, path, query) {
  const { headers } = await sign({ method: 'GET', host: HOST, path, query, headers: { 'x-amz-request-payer': 'requester' },
    region: LAKE.region, service: 's3', accessKey: env.AWS_ACCESS_KEY_ID, secretKey: env.AWS_SECRET_ACCESS_KEY, amzDate: amzNow() });
  const qs = Object.keys(query || {}).sort().map((k) => uri(k) + '=' + uri(String(query[k]))).join('&');
  return fetch('https://' + HOST + uri(path, true) + (qs ? '?' + qs : ''), { headers });
}
export const pad = (h) => String(h).padStart(12, '0');
// One object as JSON; null when it does not exist (a skipped block has no folder).
export async function lakeJson(env, key) {
  const r = await lakeFetch(env, '/' + key, null);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('lake ' + key + ' ' + r.status + ' ' + (await r.text()).slice(0, 120));
  return r.json();
}
// The block heights that exist after `after`, ascending, up to `max` (S3 lists folders in key order, and the
// keys are zero-padded heights, so this is chain order).
export async function lakeHeights(env, after, max) {
  const r = await lakeFetch(env, '/', { 'list-type': '2', delimiter: '/', 'start-after': pad(after), 'max-keys': String(max) });
  if (!r.ok) throw new Error('lake list ' + r.status + ' ' + (await r.text()).slice(0, 160));
  const xml = await r.text();
  return [...xml.matchAll(/<Prefix>(\d{12})\/<\/Prefix>/g)].map((m) => +m[1]);
}
