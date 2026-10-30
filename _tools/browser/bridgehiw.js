// "How it works" for the NEAR bridge. Replaces the inherited lx-bhiw in place (see _nearbridgecopy.js),
// the way the XRPL fork's browser/bridgehiw.js replaced Stellar's: the inherited block describes Circle
// CCTP and LayerZero burning and minting between Stellar and sixteen chains, it captures every "How it
// works" click, and copy passes never touch script bodies, so it kept explaining the wrong bridge.
//
// Same markup, classes and listeners as the block it replaces (lx-bhiw-css styles them); only the words
// change. The destinations line is read from the live list the bridge client published
// (window.__lxnBridgeNets), never written into the page.
(function(){
  if(window.__lxBhiw)return; window.__lxBhiw=1;
  var STEPS=[
    ["Pick a destination, an amount and a route","Choose where the money should arrive and how much to send. The Route panel then lists every route that can carry that asset there — NEAR Intents, Omni Bridge, Wormhole — with what each delivers."],
    ["Sign in your NEAR wallet","LumosCore’s 0.2% fee and the transfer go in the same NEAR transaction. Sending NEAR itself wraps it to wNEAR on the way where the route needs it; Omni also tops up its storage first, which carries its relayer fee."],
    ["The route delivers it","NEAR Intents: a solver fills the order in about thirty seconds with the destination chain’s own token, or refunds it. Omni Bridge: its relayers deliver Omni’s copy of the token in a few minutes. Wormhole: its guardians sign in about fifteen minutes, then you claim Wormhole’s copy from Recent transactions with an EVM wallet."],
    ["Fees, all shown before you sign","LumosCore takes 0.2% of the amount you send. The route’s own cost — NEAR Intents’ fee, Omni’s relayer fee in NEAR, or the gas of a Wormhole claim — is on the Route panel before you sign."]
  ];
  var el=null, trigger=null;

  function where(){
    var list=(window.__lxnBridgeNets&&window.__lxnBridgeNets.length)?window.__lxnBridgeNets.slice():null;
    if(!list)return "the networks in the destination picker on this page.";
    if(list.length===1)return String(list[0])+".";
    var CAP=12;
    if(list.length>CAP){
      return list.slice(0,CAP).join(", ")+" and "+(list.length-CAP)+" more — the full list is in the destination picker.";
    }
    return list.slice(0,-1).join(", ")+" and "+list[list.length-1]+".";
  }

  function build(){
    if(el)return el;
    el=document.createElement("div");
    el.className="lx-bhiw"; el.setAttribute("hidden","");
    el.setAttribute("role","dialog"); el.setAttribute("aria-modal","true");
    el.setAttribute("aria-label","How the cross-chain bridge works");
    var steps="";
    for(var i=0;i<STEPS.length;i++){
      steps+='<li data-n="'+(i+1)+'"><h4>'+STEPS[i][0]+'</h4><p>'+STEPS[i][1]+'</p></li>';
    }
    el.innerHTML='<div class="lx-bhiw-bd" data-lxbhiw-close></div>'
      +'<div class="lx-bhiw-card">'
      +'<div class="lx-bhiw-head"><h3>How the bridge works</h3>'
      +'<button class="lx-bhiw-x" type="button" aria-label="Close" data-lxbhiw-close><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>'
      +'<div class="lx-bhiw-body">'
      +'<p class="lx-bhiw-lede">LumosCore moves assets off NEAR through three routes: <b>NEAR Intents</b>, where '
      +'solvers swap into the destination chain’s own token, and <b>Omni Bridge</b> and <b>Wormhole</b>, which '
      +'carry the NEAR token itself. LumosCore never holds your funds; the route does, for as long as it takes.</p>'
      +'<ol class="lx-bhiw-steps">'+steps+'</ol>'
      +'<div class="lx-bhiw-note"><b>Only Wormhole needs a claim.</b> NEAR Intents and Omni Bridge deliver to the '
      +'address you gave with no second signature. A Wormhole transfer is claimed on the destination chain, '
      +'with an EVM wallet holding a little of its gas.</div>'
      +'<div class="lx-bhiw-chains"><b>Where it goes:</b> <span class="lx-bhiw-where"></span></div>'
      +'</div></div>';
    document.body.appendChild(el);
    return el;
  }
  function open(){
    build();
    try{ el.querySelector(".lx-bhiw-where").textContent=where(); }catch(_){}
    el.removeAttribute("hidden");
    try{ el.querySelector(".lx-bhiw-card").scrollTop=0; }catch(_){}
    try{ el.__lxOvf=document.body.style.overflow; document.body.style.overflow="hidden"; }catch(_){}
    try{ el.querySelector(".lx-bhiw-x").focus(); }catch(_){}
  }
  function close(){
    if(!el)return;
    el.setAttribute("hidden","");
    try{ document.body.style.overflow=el.__lxOvf||""; }catch(_){}
    try{ if(trigger&&trigger.focus)trigger.focus(); }catch(_){}
  }
  window.addEventListener("click",function(e){
    var t=e.target; if(!t||!t.closest)return;
    if(t.closest("[data-lxbhiw-close]")){ e.preventDefault(); e.stopImmediatePropagation(); close(); return; }
    var hit=t.closest("#mdxHiwBtn,#brHiwBtn");
    if(!hit){
      var b=t.closest("button,a");
      if(b&&/how it works/i.test((b.textContent||""))&&b.closest(".br-step,.mdx-hero-ctas,.crumb-bar,header,main"))hit=b;
    }
    if(hit){ e.preventDefault(); e.stopImmediatePropagation(); trigger=hit; open(); }
  },true);
  document.addEventListener("keydown",function(e){ if(e.key==="Escape"||e.keyCode===27)close(); });
})();
