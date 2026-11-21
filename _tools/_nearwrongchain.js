// "You are connected to the other chain" — the view-only notice, for NEAR's pages.
//
// RAZA 2026-11-14, connected on Stellar: "When i open near page while conneted to stellar, the view
// only message doesn't appear which does when i open XRPL pages."
//
// WHY NEAR WAS SILENT. This fork has no wrong-chain transform of its own: all 128 page keys carry a
// FROZEN COPY of Stellar's OLD two-chain layer, baked into the containers when the fork was taken
// ([[xrpl-inherits-a-frozen-stellar-build]] — the same trap, this side). Its head gate read the
// page's chain with a regex that knew exactly two ids:
//
//     var pc=/(^|\/)xrpl(\/|$)/.test(p)?"xrpl":(/(^|\/)stellar(\/|$)/.test(p)?"stellar":"");
//     if(!pc)return;
//
// On /trade/near neither test matches, pc is "", and the layer quits on its second line — so
// html.lx-wrongchain is never set, the body script returns too, and the notice, the CTA lock and the
// way out are all absent on every NEAR page. The two-chain NAME table and the
// `mine==="stellar"?"/stellar":"/xrpl"` way-out link were broken the same way, one step further on.
//
// THIS IS A PORT OF C:\LumosCore\_tools\_wrongchain.js, deliberately kept line-for-line alike so the
// two can be diffed. Read that file for why each piece is the shape it is — the CTA list, the
// sticky offset measured off the live header, NOTICE_OFF for /blog, CROSSCHAIN for the way-out link,
// and the address backstop that stops at shapes which cannot be mistaken for something else.
//
// TWO DELIBERATE DIFFERENCES, both forced by the fork:
//
//   1. The container filenames are NEAR's.
//   2. The chain display names are LITERAL here. Stellar reads stellar/xrpl/hedera out of
//      _tools/_chains.json; this fork has no such file. The values below are exactly what Stellar's
//      table produces today, so the two banners say the same words.
//
// IN PLACE, BY ID, SO IT MOVES NOTHING. All three blocks already exist on all 128 page keys, so a
// first run SWAPS three times per page and appends zero — the transform is order-neutral and safe to
// run on its own ([[a-transform-that-patches-in-place-cannot-reorder]]). An `appended` above zero on
// a tree that already carries the layer is the one outward sign a block is about to change position.
const fs = require('fs');
const { read, getContents } = require(__dirname + '/lib.js');
const B = String.fromCharCode(92);

// `the` and `art` are data, not rules. "connected to XRP Ledger" and "a XRP Ledger wallet" both read
// as broken English, and this sentence is the entire point of the notice; "the" belongs to the XRP
// Ledger alone, and the article follows the SOUND of the name (an Arc, a NEAR).
const CHAIN = {
  stellar: { name: 'Stellar', the: 'Stellar', art: 'a' },
  xrpl: { name: 'XRP Ledger', the: 'the XRP Ledger', art: 'an' },
  near: { name: 'NEAR', the: 'NEAR', art: 'a' },
  arc: { name: 'Arc', the: 'Arc', art: 'an' },
  hedera: { name: 'Hedera', the: 'Hedera', art: 'a' },
};

// Sections that exist on every chain, so the "Open pools on Stellar" shortcut cannot ship a 404.
// /account is /account/<chain>/<address>; /blog answers 410 on Stellar; liquidity-farming is
// Stellar-only. Everywhere else the notice still appears in full, just without a shortcut.
const CROSSCHAIN = ['trade', 'pools', 'bridge', 'rewards', 'launchpad', 'lumos'];

// The blog's categories ARE networks, so /blog/near is a real page carrying this layer — and a
// reader there has nothing to act on. RAZA 2026-11-14: "yes keep it off blog pages."
const NOTICE_OFF = ['blog'];

const CTA = ['.btn-primary', '.summary-cta', '.br-next', '.lx-cplink',
  '.dxa-trade-cta', '.mdxa-trade-cta', '.lx-fm-confirm'];

const STYLE = '<style id="lx-wrongchain-css">'
  + CTA.map((s) => 'html.lx-wrongchain ' + s).join(',')
  + '{pointer-events:none!important;opacity:.42!important;cursor:not-allowed!important;'
  + 'filter:grayscale(1)!important;box-shadow:none!important}'
  + '.lx-wcbar{position:sticky;top:calc(var(--lxwc-top,66px) + 8px);z-index:25;'
  + 'display:flex;align-items:flex-start;gap:11px;margin:0 0 18px;padding:13px 15px;'
  + 'border:1px solid var(--border-strong,#34343c);border-left:3px solid var(--accent,#ea6a2c);'
  + 'border-radius:12px;background:var(--surface-2,#1a1a1f);color:var(--text,#f6f5f3);'
  + 'font:500 13.5px/1.55 "Hanken Grotesk",system-ui,sans-serif}'
  + '.lx-wcbar b{font-weight:700}'
  + '.lx-wcbar-ic{flex:0 0 17px;width:17px;height:17px;margin-top:1px;color:var(--accent,#ea6a2c)}'
  + '.lx-wcbar-ic svg{width:100%;height:100%;display:block}'
  + '.lx-wcbar-go{display:inline-block;margin-top:5px;color:var(--accent,#ea6a2c);font-weight:700;'
  + 'text-decoration:none;border-bottom:1px solid transparent}'
  + '.lx-wcbar-go:hover{border-bottom-color:currentColor}'
  + '</style>';

// Runs in <head>, before the body exists, so the class is on <html> before anything paints and the
// CTA rule above never has a frame where it does not apply.
const HEAD = '<script id="lx-wrongchain">(function(){try{'
  + 'var KNOWN=' + JSON.stringify(Object.keys(CHAIN)) + ';'
  // A SEGMENT, not a substring, so an asset code containing a chain id cannot be read as a chain —
  // but by splitting the path and looking each piece up, not by one regex per chain. The first
  // matching segment wins: /trade/near/USDC-... is a NEAR page, not a USDC one.
  + 'var SEG=(location.pathname||"").toLowerCase().split("/").filter(Boolean);'
  + 'var pc=""; for(var i=0;i<SEG.length;i++){ if(KNOWN.indexOf(SEG[i])>=0){ pc=SEG[i]; break; } }'
  + 'if(!pc)return;'
  + 'if(' + JSON.stringify(NOTICE_OFF) + '.indexOf(SEG[0])>=0)return;'
  + 'var a="",n="";'
  + 'try{ a=localStorage.getItem("lumos.address")||"";'
  + 'n=(localStorage.getItem("lumos.network")||"").toLowerCase(); }catch(_){}'
  + 'if(!a)return;'
  // THE ADDRESS IS THE BACKSTOP, and deliberately not extended to every chain. lumos.network is read
  // first and written at connect on all of them; this only has to survive a connect path that forgot
  // to write it. A shape is safe to add when it cannot be mistaken for something else that may sit in
  // lumos.address. AN EVM 0x ADDRESS IS NOT, so Arc is absent on purpose — a 0x value in that shared
  // key is as likely to be a bridge destination as a connected Arc wallet.
  //
  // This also absorbs the legacy value: anyone who connected before the multichain rework still has
  // lumos.network === "mainnet", which is not in KNOWN, so the shape decides instead of the stale key
  // ([[lumos-network-is-not-a-chain]]).
  + 'if(KNOWN.indexOf(n)<0){ n=""; var l=a.toLowerCase();'
  + 'if(a.charAt(0)==="G"&&a.length===56)n="stellar";'
  + 'else if(a.charAt(0)==="r"&&a.length>=25&&a.length<=35)n="xrpl";'
  + 'else if(l.indexOf("0.0.")===0)n="hedera";'
  + 'else if(l.length>5&&(l.slice(-5)===".near"||l.slice(-3)===".tg"))n="near";'
  + 'else if(l.length===64&&/^[0-9a-f]+$/.test(l))n="near"; }'
  + 'if(!n||n===pc)return;'
  + 'var d=document.documentElement;'
  + 'd.classList.add("lx-wrongchain");'
  + 'd.setAttribute("data-lx-wallet-chain",n);'
  + 'd.setAttribute("data-lx-page-chain",pc);'
  + '}catch(_){}})();</' + 'script>';

const BODY = '<script id="lx-wrongchain-js">(function(){try{'
  + 'var d=document.documentElement;'
  + 'if(!d.classList.contains("lx-wrongchain"))return;'
  + 'var CH=' + JSON.stringify(CHAIN) + ';'
  + 'var XS=' + JSON.stringify(CROSSCHAIN) + ';'
  + 'var NAME={};for(var nk in CH){ if(CH.hasOwnProperty(nk))NAME[nk]=CH[nk].name; }'
  + 'var mine=d.getAttribute("data-lx-wallet-chain")||"";'
  + 'var here=d.getAttribute("data-lx-page-chain")||"";'
  + 'var CTA=' + JSON.stringify(CTA.join(',')) + ';'
  + 'function lock(root){ try{'
  + '[].forEach.call((root||document).querySelectorAll(CTA),function(b){'
  + 'if(b.getAttribute("data-lxwc")==="1")return;'
  + 'b.setAttribute("data-lxwc","1");'
  + 'b.setAttribute("aria-disabled","true");'
  + 'if(b.tagName==="BUTTON"||b.tagName==="INPUT")b.disabled=true;'
  + 'b.setAttribute("title","Connected to "+(NAME[mine]||mine)+" — switch wallets to use "+(NAME[here]||here)+".");'
  + '}); }catch(_){} }'
  + 'function bar(){'
  + 'if(document.querySelector(".lx-wcbar"))return;'
  + 'var host=document.querySelector(".page")||document.querySelector("main")||document.querySelector(".container");'
  + 'if(!host)return;'
  + 'var el=document.createElement("div");'
  + 'el.className="lx-wcbar"; el.setAttribute("role","status");'
  + 'var ic=document.createElement("span"); ic.className="lx-wcbar-ic";'
  + 'ic.innerHTML=\'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"><circle cx="12" cy="12" r="9"></circle><path d="M12 8v5"></path><path d="M12 16.2v.1"></path></svg>\';'
  + 'function THE(c){ return (CH[c]&&CH[c].the)||c; }'
  + 'function AN(c){ return CH[c]?(CH[c].art+" "+CH[c].name):c; }'
  + 'var tx=document.createElement("div");'
  + 'var b=document.createElement("b"); b.textContent="View only mode. ";'
  + 'tx.appendChild(b);'
  + 'tx.appendChild(document.createTextNode("You are currently connected to "+THE(mine)'
  + '+". To use "+THE(here)+", disconnect and connect "+AN(here)+" wallet."));'
  // The old frozen form hard-coded the two ids ("/stellar" or else "/xrpl"), so with a third chain
  // connected it sent a NEAR wallet to the XRPL page; and it offered the link for any first segment
  // at all, including /account and /blog, where the target is a 404 and a 410.
  + 'var seg=(location.pathname||"/").toLowerCase().split("/").filter(Boolean)[0]||"";'
  + 'if(seg&&XS.indexOf(seg)>=0&&CH[mine]){ var go=document.createElement("a"); go.className="lx-wcbar-go";'
  + 'go.href="/"+seg+"/"+mine;'
  + 'go.textContent="Open "+seg+" on "+THE(mine)+" \\u2192";'
  + 'tx.appendChild(document.createElement("br")); tx.appendChild(go); }'
  + 'el.appendChild(ic); el.appendChild(tx);'
  // After the breadcrumb when there is one, so the notice sits with the content rather than above
  // the navigation that got you here.
  //
  // THE CRUMB IS NOT ALWAYS THE FIRST CHILD ON THIS FORK, which is the one real divergence from
  // Stellar's copy. Stellar tests host.firstElementChild only; on NEAR's /trade/near the host's
  // children are [section.lx-lp (the hidden hub chooser), div.crumb, section.dex-hero], so that test
  // misses and the notice lands ABOVE "Back to dashboard" while the XRPL pages put it below —
  // measured on staging 3ad2e821. Scanning the direct children for the crumb gives the same answer as
  // Stellar's test wherever the crumb IS first, so this is strictly the more general rule; it is
  // worth lifting back into _wrongchain.js and _xrplwhead's sibling, where it changes nothing today.
  + 'var crumb=null;'
  + 'for(var ci=0;ci<host.children.length;ci++){ var cc=host.children[ci];'
  + 'if(cc.classList&&cc.classList.contains("crumb")){ crumb=cc; break; } }'
  + 'if(crumb)host.insertBefore(el,crumb.nextSibling);'
  + 'else host.insertBefore(el,host.firstElementChild);'
  + '}'
  // What the sticky bar has to clear, read off the page instead of assumed. Only a header actually
  // PINNED at the top counts: the desktop sidebar is sticky too and 900px tall.
  + 'function fit(){ try{'
  + 'var best=0, c=document.querySelectorAll(".appbar,.topbar,header");'
  + 'for(var i=0;i<c.length;i++){ var e=c[i], s=getComputedStyle(e);'
  + 'if(s.position!=="sticky"&&s.position!=="fixed")continue;'
  + 'var r=e.getBoundingClientRect();'
  + 'if(r.top>2||r.height<24||r.height>160)continue;'
  + 'if(r.height>best)best=r.height; }'
  + 'if(best)document.documentElement.style.setProperty("--lxwc-top",Math.round(best)+"px");'
  + '}catch(_){} }'
  + 'function run(){ bar(); fit(); lock(document); }'
  + 'try{ addEventListener("resize",fit,{passive:true}); addEventListener("load",fit); }catch(_){}'
  + 'if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",run);else run();'
  + 'try{ new MutationObserver(function(ms){ for(var i=0;i<ms.length;i++){ var ad=ms[i].addedNodes;'
  + 'for(var j=0;j<ad.length;j++){ if(ad[j].nodeType===1)lock(ad[j]); } } })'
  + '.observe(document.documentElement,{childList:true,subtree:true}); }catch(_){}'
  + '}catch(_){}})();</' + 'script>';

let files = 0, pages = 0, swapped = 0, appended = 0;
for (const dev of ['desktop', 'mobile']) {
  const file = 'lumoscore-near-' + dev + '.html';
  let data;
  try { data = read(file); } catch (e) { console.error('  ' + file + ': missing — skipped'); continue; }
  const { json, s, e } = getContents(data);
  files++;

  for (const k of Object.keys(json)) {
    let h = json[k];
    if (typeof h !== 'string') continue;
    if (h.indexOf('</head>') < 0 || h.indexOf('</body>') < 0) continue;

    for (const [open, close, block, tail] of [
      ['<style id="lx-wrongchain-css">', '</style>', STYLE, '</head>'],
      ['<script id="lx-wrongchain">', '</script>', HEAD, '</head>'],
      ['<script id="lx-wrongchain-js">', '</script>', BODY, '</body>'],
    ]) {
      const at = h.indexOf(open);
      const end = at < 0 ? -1 : h.indexOf(close, at);
      if (at >= 0 && end > at) { h = h.slice(0, at) + block + h.slice(end + close.length); swapped++; continue; }
      if (tail === '</head>') { h = h.replace('</head>', block + '</head>'); }
      else { const bi = h.lastIndexOf('</body>'); h = h.slice(0, bi) + block + h.slice(bi); }
      appended++;
    }
    json[k] = h;
    pages++;
  }

  const serialized = JSON.stringify(json).split('</').join('<' + B + '/');
  fs.writeFileSync(file, data.slice(0, s) + serialized + data.slice(e), 'utf8');
}

console.log('near wrong-chain notice: ' + pages + ' page key(s) across ' + files + ' container(s) — '
  + swapped + ' block(s) swapped in place, ' + appended + ' appended');
if (!files) { console.error('  ! no container was read'); process.exit(1); }
