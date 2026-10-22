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
    ["Pick a destination and an amount","Choose where the money should arrive, the asset you want there, and how much to send. The list of destinations is read live from NEAR Intents, so the picker cannot offer a network it has stopped serving."],
    ["One NEAR transaction","You sign a single transaction in your NEAR wallet. It pays LumosCore’s fee and deposits the rest with NEAR Intents in the same step — both happen, or neither does. Sending NEAR itself wraps it to wNEAR inside that same transaction."],
    ["NEAR Intents delivers it","A NEAR Intents solver holds the deposit for about thirty seconds while it fills the order, then sends the asset you chose to the address you gave — the destination chain’s own token, not a wrapped copy. If it cannot be filled, it is refunded to the NEAR account that paid."],
    ["Fees, all shown before you sign","LumosCore takes 0.2% of the amount you send. NEAR Intents charges its own fee on top, and the amount you are quoted is what arrives after all of it."]
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
      +'<p class="lx-bhiw-lede">LumosCore moves assets off NEAR through <b>NEAR Intents</b>, an intent network '
      +'where solvers compete to fill your transfer. LumosCore never holds your funds; for the half-minute a '
      +'transfer takes, NEAR Intents does.</p>'
      +'<ol class="lx-bhiw-steps">'+steps+'</ol>'
      +'<div class="lx-bhiw-note"><b>Nothing to claim.</b> The asset is delivered to the address you gave, with '
      +'no second signature and no gas needed on the destination chain. Circle’s CCTP, which asks you to '
      +'claim on arrival, does not reach NEAR and is not used here.</div>'
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
