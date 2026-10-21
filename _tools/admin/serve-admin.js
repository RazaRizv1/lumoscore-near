// Serve the one-off operator page(s) in _tools/admin on localhost ONLY.
//
//   node _tools/admin/serve-admin.js      -> http://localhost:8160/feereg.html
//
// Not part of the site build and never deployed: it lives outside dist/ and binds 127.0.0.1. It serves the
// page, the self-hosted NEAR Connect bundle and pinned wallet list from assets/vendor, and the curated
// token list (i, s) from _tools/nearcurated.generated.json.
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const PORT = +process.argv[2] || 8160;
const FILES = {
  '/feereg.html': [path.join(__dirname, 'feereg.html'), 'text/html; charset=utf-8'],
  '/vendor/near-connect-0.11.4.min.js': [path.join(ROOT, 'assets', 'vendor', 'near-connect-0.11.4.min.js'), 'application/javascript'],
  '/vendor/near-wallets-manifest.json': [path.join(ROOT, 'assets', 'vendor', 'near-wallets-manifest.json'), 'application/json'],
};

http.createServer((req, res) => {
  const p = new URL(req.url, 'http://x').pathname;
  if (p === '/curated.json') {
    const j = JSON.parse(fs.readFileSync(path.join(ROOT, '_tools', 'nearcurated.generated.json'), 'utf8'));
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify(j.tokens.map((t) => ({ i: t.i, s: t.s }))));
  }
  const f = FILES[p === '/' ? '/feereg.html' : p];
  if (!f) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'content-type': f[1] });
  fs.createReadStream(f[0]).pipe(res);
}).listen(PORT, '127.0.0.1', () => console.log('operator page: http://localhost:' + PORT + '/feereg.html'));
