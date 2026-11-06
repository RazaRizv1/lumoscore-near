// GET /lxapi/neartokensearch?q=epep — NEAR tokens by symbol or name, curated or not, for the search box.
//
// RAZA 2026-11-06: "Why am i unable to search this asset. its not curated". The box only knew the curated list, so a
// token with a contract and no listing could be opened by its url and not found by its name. Intear's price index keeps
// every token NEAR has, and is asked from here so a visitor's keystrokes do not go to a third party from their browser.
// Symbols and names are chosen by whoever deployed the token: the page cleans them and writes them as text. Icons are
// left out (data urls, the page takes them from the indexer). A failed call says so; the page keeps its curated rows.
const SEARCH = 'https://prices.intear.tech/token-search';
const ID = /^[a-z0-9][a-z0-9._-]{1,63}$/;

function json(body, maxAge) {
  return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json; charset=utf-8',
    'cache-control': 'public, max-age=' + maxAge, 'access-control-allow-origin': '*' } });
}

export async function onRequestGet(context) {
  const q = String(new URL(context.request.url).searchParams.get('q') || '').trim().toLowerCase().slice(0, 40);
  if (q.length < 2) return json({ ok: false, error: 'no query' }, 0);
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 5000);
  try {
    const r = await fetch(SEARCH + '?q=' + encodeURIComponent(q), { signal: ctl.signal, headers: { accept: 'application/json', 'user-agent': 'LumosCore/1.0' } });
    if (!r.ok) throw new Error('intear ' + r.status);
    const a = await r.json();
    if (!Array.isArray(a)) throw new Error('intear: unexpected answer');
    const rows = [];
    for (const x of a) {
      const i = String((x && x.account_id) || ''), m = (x && x.metadata) || {};
      if (!ID.test(i) || !m.symbol) continue;
      rows.push({ i, n: String(m.symbol).slice(0, 40), nm: String(m.name || '').slice(0, 80) });
      if (rows.length >= 12) break;
    }
    return json({ ok: true, rows }, 300);
  } catch (e) {
    return json({ ok: false, error: 'search unavailable' }, 0);
  } finally { clearTimeout(t); }
}
