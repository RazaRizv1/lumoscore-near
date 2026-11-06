// GET /lxapi/nearpoolvol?ids=1,2,3 — 24h volume in USD for pools outside the curated list, for the Pools page.
//
// RAZA 2026-11-06: "After page 2 and onwards, most of the pools dont have anything in Vol, Fees". Those rows come from
// the list baked at build, and the live sources only carry curated pools. Rhea's data service answers any pool, 80 ids a
// call, so the page asks for the rows it is showing. The answer is an array in the order asked; a failed call says
// so ({ok:false}) and the page keeps its dash, because "could not ask" is not "no volume".
const VOL = 'https://api.data-service.ref.finance/api/poollist/';

function json(body, maxAge) {
  return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json; charset=utf-8',
    'cache-control': 'public, max-age=' + maxAge, 'access-control-allow-origin': '*' } });
}

export async function onRequestGet(context) {
  const ids = String(new URL(context.request.url).searchParams.get('ids') || '').split(',').filter((x) => /^[0-9]{1,7}$/.test(x)).slice(0, 80);
  if (!ids.length) return json({ ok: false, error: 'no ids' }, 0);
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 6000);
  try {
    const r = await fetch(VOL + ids.join('|') + '/rolling24hvolume/sum', { signal: ctl.signal, headers: { accept: 'application/json', 'user-agent': 'LumosCore/1.0 (+https://lumoscore.com)' } });
    if (!r.ok) throw new Error('rhea ' + r.status);
    const a = await r.json();
    if (!Array.isArray(a) || a.length !== ids.length) throw new Error('rhea: unexpected answer');
    const c = {};
    ids.forEach((id, k) => { const v = Number(a[k]); if (isFinite(v) && v >= 0) c[id] = v; });
    return json({ ok: true, c }, 300);
  } catch (e) {
    return json({ ok: false, error: 'volume unavailable' }, 0);
  } finally { clearTimeout(t); }
}
