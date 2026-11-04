// "How it works" on the NEAR Launchpad: the lx-lhiw dialog, NEAR's own copy.
//
// RAZA 2026-11-03: "Add How it works popup modal and subtitle copy to the Launchpad page on NEAR network
// (matching Stellar reference)". Same component as Stellar's _launchhiw.js (ids, CSS, behaviour), which this
// fork never received: it is not in the frozen base. Two things in Stellar's copy are NOT true here and were
// not carried over, both read from browser/nearmint.js:
//   * "one transaction": a NEAR launch is FOUR wallet approvals (token, pool, liquidity, lock) -- the pool id
//     exists only after the pool step, and the share count only after the liquidity, so they cannot be folded.
//   * the lock: TRUE here since 2026-11-03 (RAZA: "Yes, lock it"). Step 4 sends the launcher's pool shares to
//     the all-zeros account, which has no keys (browser/nearmint.js buildLockTxs), so Stellar's note stands.
//   * the price: $5 + $10 plus NEAR's own storage for the token and pool (about $7 on 2026-11-03), not a
//     flat $25 -- the cost panel beside the form prints the real figure.
// The trigger: the subtitle link _nearlaunchpad.js writes (data-lxlhiw), else any control saying "how it works".
const { read, getContents } = require(__dirname + '/lib.js');

const B = String.fromCharCode(92);
const ID = 'lx-lhiw';

const CLOSE = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
  + 'stroke-width="2.4" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/>'
  + '<line x1="6" y1="6" x2="18" y2="18"/></svg>';

const STYLE = `<style id="${ID}-css">
.lx-lhiw{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px}
.lx-lhiw[hidden]{display:none}
.lx-lhiw-bd{position:absolute;inset:0;background:rgba(8,8,12,.62);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px)}
.lx-lhiw-card{position:relative;z-index:1;width:100%;max-width:580px;max-height:86vh;max-height:86dvh;
  overflow:auto;-webkit-overflow-scrolling:touch;background:var(--surface,#fff);
  border:1px solid var(--border);border-radius:18px;box-shadow:0 30px 70px -20px rgba(0,0,0,.55)}
.lx-lhiw-head{position:sticky;top:0;display:flex;align-items:center;gap:12px;padding:17px 20px;
  background:var(--surface,#fff);border-bottom:1px solid var(--border);z-index:1}
.lx-lhiw-head h3{flex:1;margin:0;font-size:16.5px;font-weight:800;color:var(--text)}
.lx-lhiw-x{width:30px;height:30px;flex:0 0 30px;border-radius:9px;border:1px solid var(--border);
  background:transparent;color:var(--text-soft);cursor:pointer;display:grid;place-items:center}
.lx-lhiw-x:hover{color:var(--text);border-color:var(--border-strong)}
.lx-lhiw-body{padding:18px 20px 22px}
.lx-lhiw-lede{margin:0 0 18px;font-size:14px;line-height:1.6;color:var(--text-soft)}
.lx-lhiw-lede b{color:var(--text);font-weight:700}
.lx-lhiw-steps{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:0}
.lx-lhiw-steps li{position:relative;padding:0 0 20px 40px}
.lx-lhiw-steps li:last-child{padding-bottom:4px}
.lx-lhiw-steps li::before{content:attr(data-n);position:absolute;left:0;top:0;width:26px;height:26px;
  border-radius:50%;display:grid;place-items:center;font:800 12px/1 'JetBrains Mono',monospace;
  background:var(--accent-pale,rgba(234,106,44,.13));color:var(--accent,#ea6a2c)}
.lx-lhiw-steps li:not(:last-child)::after{content:"";position:absolute;left:13px;top:30px;bottom:6px;
  width:1px;background:var(--border)}
.lx-lhiw-steps h4{margin:3px 0 4px;font-size:14px;font-weight:800;color:var(--text)}
.lx-lhiw-steps p{margin:0;font-size:13.5px;line-height:1.55;color:var(--text-soft)}
.lx-lhiw-note{margin-top:18px;padding:12px 14px;border-radius:12px;
  border:1px solid var(--border);background:var(--surface-2);
  font-size:13px;line-height:1.55;color:var(--text-soft)}
.lx-lhiw-note b{color:var(--text)}
@media(max-width:560px){
.lx-lhiw{padding:12px;align-items:flex-start}
.lx-lhiw-body{padding:16px 16px 20px}
}
</style>`;

// ---- the copy, in one place so it can be read as prose and checked as prose -----------------------
// Typographic marks are written as HTML entities on purpose. This whole script is assembled inside a
// template literal and then embedded in a JSON container, so a literal apostrophe or em dash would
// have to survive two escaping layers; an entity is decoded by innerHTML and survives both untouched.
// See [[template-literal-eats-escapes]] and [[ldjson-escape-was-a-no-op]].
// SHORT, AND IN THE READER'S WORDS (RAZA 2026-11-01, on Stellar's first long version): only what the launcher
// DECIDES or PAYS, and the one non-obvious fact about their money -- here, that the liquidity stays theirs.
const LEDE = 'Issue your own token on NEAR and open its first liquidity pool &#8212; no code, and no '
  + 'contract to write. Your wallet approves it in <b>four steps</b>.';

const STEPS = [
  ['Set it up',
   'Name, ticker, logo, and how much of the supply you keep &#8212; up to 30%. The rest goes into the '
   + 'pool.'],
  ['Pay $25',
   // RAZA 2026-11-04: worded so it does not suggest the whole $10 goes into the pool -- $5 of NEAR does, beside
   // $5 worth of the new token; the rest of the $10 is LumosCore's (browser/nearlaunch.js USD_LIQ_LINE).
   '$5 to create the token, $10 for liquidity and $10 for the pool and network, paid in NEAR at the current '
   + 'rate. Your pool opens with $5 in NEAR and $5 worth of your new token.'],
  ['Your token goes live',
   'The supply is created, your share lands in your wallet, and the rest opens a pool so people can '
   + 'trade it straight away.'],
  ['It locks',
   'The supply is fixed forever &#8212; no more can ever be made.'],
];

const NOTE = '<b>Your pool&#8217;s starting liquidity stays in it for good.</b> Nobody can take it out '
  + '&#8212; not you, and not us. That is what stops a token launched here being rugged.';

const TITLE = 'How a NEAR launch works';

// ---- the layer ------------------------------------------------------------------------------------
// The trigger is matched by DATA ATTRIBUTE first (extract_site.js stamps data-lxlhiw on the link it
// injects), then by what the control SAYS, because the middleware that injects the link and the page
// that carries this dialog are deployed from the same build but not necessarily at the same moment --
// a stale edge would otherwise leave the link dead again with nothing reporting it.
const SCRIPT = `<script id="${ID}">(function(){
  if(window.__lxLhiw)return; window.__lxLhiw=1;
  var STEPS=${JSON.stringify(STEPS)};
  var el=null, trigger=null;
  function build(){
    if(el)return el;
    el=document.createElement("div");
    el.className="lx-lhiw"; el.setAttribute("hidden","");
    el.setAttribute("role","dialog"); el.setAttribute("aria-modal","true");
    el.setAttribute("aria-label",${JSON.stringify(TITLE)});
    var steps="";
    for(var i=0;i<STEPS.length;i++){
      steps+='<li data-n="'+(i+1)+'"><h4>'+STEPS[i][0]+'</h4><p>'+STEPS[i][1]+'</p></li>';
    }
    el.innerHTML='<div class="lx-lhiw-bd" data-lxlhiw-close></div>'
      +'<div class="lx-lhiw-card">'
      +'<div class="lx-lhiw-head"><h3>${TITLE}</h3>'
      +'<button class="lx-lhiw-x" type="button" aria-label="Close" data-lxlhiw-close>${CLOSE}</button></div>'
      +'<div class="lx-lhiw-body">'
      +'<p class="lx-lhiw-lede">${LEDE}</p>'
      +'<ol class="lx-lhiw-steps">'+steps+'</ol>'
      +'<div class="lx-lhiw-note">${NOTE}</div>'
      +'</div></div>';
    document.body.appendChild(el);
    return el;
  }
  function open(){
    build(); el.removeAttribute("hidden");
    try{ el.querySelector(".lx-lhiw-card").scrollTop=0; }catch(_){}
    try{ el.__lxOvf=document.body.style.overflow; document.body.style.overflow="hidden"; }catch(_){}
    try{ el.querySelector(".lx-lhiw-x").focus(); }catch(_){}
  }
  function close(){
    if(!el)return;
    el.setAttribute("hidden","");
    try{ document.body.style.overflow=el.__lxOvf||""; }catch(_){}
    try{ if(trigger&&trigger.focus)trigger.focus(); }catch(_){}
  }
  window.addEventListener("click",function(e){
    var t=e.target; if(!t||!t.closest)return;
    if(t.closest("[data-lxlhiw-close]")){ e.preventDefault(); e.stopImmediatePropagation(); close(); return; }
    var hit=t.closest("[data-lxlhiw]");
    if(!hit){
      var b=t.closest("a,button");
      if(b&&/how it works/i.test(b.textContent||""))hit=b;
    }
    if(hit){ e.preventDefault(); e.stopImmediatePropagation(); trigger=hit; open(); }
  },true);
  document.addEventListener("keydown",function(e){ if(e.key==="Escape"||e.keyCode===27)close(); });
})();</` + `script>`;

const RE_STYLE = new RegExp('<style id="' + ID + '-css">[' + B + 's' + B + 'S]*?<' + B + '/style>', 'g');
const RE_SCRIPT = new RegExp('<script id="' + ID + '">[' + B + 's' + B + 'S]*?<' + B + '/script>', 'g');

let files = 0, pages = 0;
for (const dev of ['desktop', 'mobile']) {
  const file = `lumoscore-near-${dev}.html`;
  let data;
  try { data = read(file); } catch (e) { console.error('  ' + file + ': missing - skipped'); continue; }
  const { json, s, e } = getContents(data);
  files++;
  let changed = false;

  for (const key of Object.keys(json)) {
    if (typeof json[key] !== 'string') continue;
    // THE FORM PAGE ONLY. /launchpad and /launchpad/stellar both resolve to lumoscore-launch-token;
    // the review and confirm pages carry no such link and have no business shipping the layer.
    if (key.indexOf('launch-token') < 0) continue;

    let p = json[key];
    // strip our own previous output first, so a second run produces identical bytes
    p = p.replace(RE_STYLE, '').replace(RE_SCRIPT, '');

    const hi = p.indexOf('</' + 'head>');
    if (hi < 0) { console.error('  ' + key + ': no closing head - aborting'); process.exit(1); }
    p = p.slice(0, hi) + STYLE + p.slice(hi);

    const bi = p.lastIndexOf('</' + 'body>');
    if (bi < 0) { console.error('  ' + key + ': no closing body - aborting'); process.exit(1); }
    p = p.slice(0, bi) + SCRIPT + p.slice(bi);

    json[key] = p; pages++; changed = true;
  }

  if (!changed) continue;
  const serialized = JSON.stringify(json).split('</').join('<' + B + '/');
  require('fs').writeFileSync(file, data.slice(0, s) + serialized + data.slice(e), 'utf8');
}
console.log('NEAR Launchpad "How it works" dialog on ' + pages + ' page(s) across ' + files + ' container(s)');
