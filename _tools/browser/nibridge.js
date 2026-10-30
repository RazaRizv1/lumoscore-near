// Bridge page: NEAR Intents (1Click) out of NEAR — destinations, quotes and the send.
//
// PORTED FROM THE XRPL FORK'S browser/nibridge.js, NEAR Intents route only. XRPL's other two routes do
// not exist here (Axelar ITS and THORChain do not take NEAR), and Circle CCTP does not reach NEAR, so the
// route panel carries exactly one card -- the panel's own `:only-child` rule makes it span the row. Every
// behaviour that survived the XRPL rounds is kept: the reachable-only destination list with its click
// blocker, the per-route note that can never be blank (quoteReason), the indicative estimate that is not
// a quote, the review figures that are not erased while a re-quote is in flight, the red banner for an
// over-balance amount, and the post-delivery reset.
//
// WHAT IS DIFFERENT, all consequences of the origin chain:
//   * THE SOURCE IS ANY CURATED NEAR TOKEN 1CLICK ACCEPTS, plus native NEAR. /lxapi/nearoneclick?op=tokens
//     answers the intersection (`origins`); the wallet's balances come from FastNEAR's token index.
//   * NATIVE NEAR IS WRAPPED IN THE SAME TRANSACTION. 1Click lists no native NEAR asset on chain `near`,
//     only nep141:wrap.near, so a NEAR transfer is near_deposit on wrap.near followed by the wNEAR
//     ft_transfers, all in one transaction to wrap.near. A plain Transfer of NEAR to the deposit account
//     would not be a wNEAR deposit, and nothing here guesses that 1Click would credit it anyway.
//   * ONE TRANSACTION, ONE SIGNATURE, ATOMIC. NEAR actions to one receiver run in one receipt, so the
//     optional storage registrations, LumosCore's fee and the deposit either all apply or none do -- the
//     fee cannot be taken for a deposit that did not happen, which on XRPL needed Batch to promise.
//   * THE FEE IS 0.2% OF THE INPUT, IN THE INPUT TOKEN, to fees-lumoscore.near with memo `lx:ni` -- the
//     marker rides on the fee, as on XRPL. The fee account must already be registered on that token (the
//     user never pays for our registration), so a token it is not registered on stays "coming soon",
//     exactly as nearswap.js does for swaps. window.lxnSwap (nearswap.js, injected before this file) is the
//     one place the fee account, the test override and the unit arithmetic live.
//   * THE DEPOSIT ACCOUNT MAY NEED A STORAGE DEPOSIT. Each quote gets its own NEAR account; if it is not
//     registered on the token, a storage_deposit for it goes first in the same transaction, paid by the
//     sender (about 0.00125 NEAR), because an ft_transfer to an unregistered account fails.
//
// TWO MORE ROUTES (RAZA 2026-10-30: "why only near intents as cross chain bridge on Near. I need 2 more"):
// OMNI BRIDGE and WORMHOLE, engines in browser/nearbridges.js (window.lxnBr). Both carry THE TOKEN ITSELF
// as a bridged copy, where NEAR Intents swaps into the destination's own asset -- so which route is in
// use decides what the reader is told arrives (curRoute), and a hand-picked route is never swapped for
// another behind their back. NEAR Intents stays first, so with nothing picked the page is as it was.
//
// NOTHING HERE FABRICATES A NUMBER. Every delivered figure comes from a live 1Click quote; the one
// indicative estimate is labelled with the same tilde Stellar uses and is replaced by the quote.
(function () {
  if (window.__lxnNiBridge) return;
  window.__lxnNiBridge = 1;

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return [].slice.call((r || document).querySelectorAll(s)); };
  function norm(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }

  var API = '/lxapi/nearoneclick';
  var FT_API = 'https://api.fastnear.com/v1/account/';
  var WNEAR = 'wrap.near';
  var TGAS = '000000000000';
  var NEAR_LOGO = '/assets/networks/near.png';
  var TX_KEY = 'lumos.near.ni.txs';          // NOT lumos.ni.txs: the combined site shares localStorage
                                             // with the XRPL build, which writes that key.

  // THE DESTINATION CHAINS, keyed by 1Click's chain id, named the way the design's dropdown already
  // names them where it has an entry (so those options are revealed rather than duplicated).
  //
  // MUST MATCH the CHAINS map in functions/lxapi/nearoneclick.js. _tools/_nearintents.js fails the build
  // when the two disagree.
  var NI_CHAIN = {
    eth: 'Ethereum', arb: 'Arbitrum', base: 'Base', op: 'Optimism', pol: 'Polygon',
    avax: 'Avalanche', bsc: 'BNB Chain', scroll: 'Scroll', gnosis: 'Gnosis', bera: 'Berachain',
    monad: 'Monad', plasma: 'Plasma', xlayer: 'X Layer', abs: 'Abstract', hood: 'Hood',
    hypercore: 'Hyperliquid', sol: 'Solana', sui: 'Sui', starknet: 'Starknet',
    aptos: 'Aptos', movement: 'Movement', ton: 'TON', tron: 'Tron', cardano: 'Cardano',
    btc: 'Bitcoin', ltc: 'Litecoin', doge: 'Dogecoin', bch: 'Bitcoin Cash', dash: 'Dash',
    zec: 'Zcash', aleo: 'Aleo', fogo: 'Fogo', adi: 'ADI', stellar: 'Stellar', xrp: 'XRPL'
  };

  var TOKENS = null, KEYED = false;
  var BY_CHAIN = {};                // chain -> [token]
  var ORIGINS = [];                 // the source assets 1Click accepts from NEAR, curated only
  var SRC = null;                   // the chosen source asset
  var DEST = null;                  // {chain, token}
  var QUOTE = null;                 // the last live dry quote
  var QUOTING = false;              // a quote is in flight -- distinct from having been refused one
  var BEST = '';                    // 'ni' once a quote exists; the panel and the CTA read it
  var LAST_NOTE = '';               // why there is no quote, in words the user can act on
  var NOTE = { ni: '', om: '', wh: '' };  // each route's own refusal; see quoteReason()
  var HOLD = {};                    // contract -> raw balance the wallet holds
  var HOLD_ME = '';                 // which account HOLD belongs to
  var NEAR_SPEND = null;            // raw NEAR the account can spend after storage and the gas keep
  var FEE_OK = {};                  // contract -> true | false | null (could not ask)
  var OMQ = null;                   // Omni's answer: { nativeFee, usd, carried }
  var WHQ = null;                   // Wormhole's: { carried } -- it has no relayer, so no fee to ask about
  var PICKED = '';                  // a route the reader chose by hand
  var PICKED_FOR = '';              // the destination it was chosen on; it means nothing anywhere else
  var NEAR_RAW = null;              // raw NEAR beyond storage, for the bridges' gas checks
  var busy = false;

  function S() { return window.lxnSwap; }
  function BRX() { return window.lxnBr || null; }
  function feeBps() { return (S() && S().FEE_BPS) || 20; }
  function addr() {
    try { if (window.lxn && typeof window.lxn.account === 'function') return window.lxn.account() || ''; } catch (e) {}
    return '';
  }
  function short(a) { return a && a.length > 14 ? a.slice(0, 6) + '…' + a.slice(-4) : (a || ''); }
  function fmt(n, dp) {
    var x = Number(n);
    if (!isFinite(x)) return '—';
    return x.toLocaleString('en-US', { maximumFractionDigits: dp == null ? 6 : dp });
  }
  function big(s) { return BigInt(String(s == null ? '0' : s)); }
  function toUnits(str, dec) { return S() ? S().toUnits(str, dec) : null; }
  function fromUnits(raw, dec) { return S() ? S().fromUnits(raw, dec) : '0'; }

  // A ROUTE'S OWN INTERNAL FAULT IS NOT A MESSAGE FOR A READER (XRPL, 2026-09-29). A refusal the reader
  // CAN act on is passed through -- and 1Click's minimum is restated in the units the input is in: their
  // "try at least 105253" is raw units of what reaches them, which is the amount AFTER LumosCore's fee,
  // so the figure to type is that grossed back up, in the token's own decimals.
  function upstreamNote(msg) {
    var s = String(msg || '');
    if (/internal server error|bad gateway|service unavailable|gateway time|^\s*5\d\d\s*$/i.test(s)) {
      return 'NEAR Intents is not answering right now — try again shortly.';
    }
    var m = /try at least\s+([0-9]+)/i.exec(s);
    if (m && SRC) {
      var bps = BigInt(feeBps());
      var gross = (big(m[1]) * BigInt(10000) + (BigInt(10000) - bps) - BigInt(1)) / (BigInt(10000) - bps);
      return 'Minimum ' + fmt(fromUnits(gross.toString(), SRC.decimals), 6) + ' ' + SRC.symbol;
    }
    return s ? (s.charAt(0).toUpperCase() + s.slice(1)) : s;
  }

  // ---- chain and token artwork ---------------------------------------------------------------------
  // Shipped files first (stamped at build: which exist and a version hash of their bytes, because
  // /assets is served immutable for a year), the CoinGecko proxy only as a fallback.
  var ICONV = '__LX_ICONV__';
  var NI_TOKEN = __LX_NI_TOKENS__;
  var NET_HAVE = __LX_NET_FILES__;
  var NET_FILE = {
    Ethereum: 'ethereum', Arbitrum: 'arbitrum', Base: 'base', Optimism: 'optimism',
    Polygon: 'polygon', Avalanche: 'avalanche', 'BNB Chain': 'bnbchain', Scroll: 'scroll',
    Gnosis: 'gnosis', Berachain: 'berachain', Monad: 'monad', Plasma: 'plasma',
    'X Layer': 'xlayer', Hood: 'hood', Hyperliquid: 'hyperliquid', Solana: 'solana',
    Sui: 'sui', Starknet: 'starknet', Aptos: 'aptos', Movement: 'movement',
    TON: 'ton', Tron: 'tron', Cardano: 'cardano', Bitcoin: 'bitcoin', Litecoin: 'litecoin',
    Dogecoin: 'dogecoin', 'Bitcoin Cash': 'bitcoincash', Dash: 'dash', Zcash: 'zcash',
    Fogo: 'fogo', ADI: 'adi', Stellar: 'stellar', Abstract: 'abstract', Aleo: 'aleo',
    XRPL: 'xrpl', NEAR: 'near', Near: 'near',
    Linea: 'linea', Mantle: 'mantle', Sei: 'sei', 'World Chain': 'worldchain', Hedera: 'hedera'
  };
  function netFile(label) {
    var f = NET_FILE[label];
    return f && NET_HAVE[f] ? ('/assets/networks/' + f + '.png?v=' + ICONV) : '';
  }
  function chainLogo(label) {
    var direct = netFile(label) || netFile(NI_CHAIN[label] || '');
    if (direct) return direct;
    var list = BY_CHAIN[label] || [];
    var nat = list.filter(function (t) { return !t.contractAddress; })[0] || list[0];
    return nat && nat.coingeckoId ? (API + '?op=logo&id=' + encodeURIComponent(nat.coingeckoId)) : '';
  }
  function symLogo(sym) {
    var s = String(sym || '').replace(/[^A-Za-z0-9._-]/g, '');
    return s && NI_TOKEN[s] ? ('/assets/tokens/ni/' + s + '.png?v=' + ICONV) : '';
  }
  function tokenLogo(t, placeKey) {
    if (!t) return '';
    var s = symLogo(t.symbol);
    if (s) return s;
    if (!t.contractAddress && placeKey) {
      var cl = chainLogo(placeLabel(placeKey));
      if (cl) return cl;
    }
    return t.coingeckoId ? (API + '?op=logo&id=' + encodeURIComponent(t.coingeckoId)) : '';
  }
  // A SOURCE ROW'S LOGO: native NEAR's own mark; a curated token's shipped art by its symbol, else the
  // curated logo the Function passed through (only https: or data:image, checked there), else letters.
  function rowLogo(a) {
    if (!a) return '';
    if (a.native) return NEAR_LOGO;
    return symLogo(a.symbol) || a.logo || '';
  }

  function markLetters(host, name) {
    if (!host) return;
    host.textContent = '';
    var s = document.createElement('span');
    s.className = 'lx-netlm2';
    s.style.cssText = 'display:flex;align-items:center;justify-content:center;width:100%;height:100%;'
      + 'border-radius:50%;background:#5b6170;color:#fff;font-weight:700';
    s.style.setProperty('font-size', '9px', 'important');
    s.textContent = String(name || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase();
    host.appendChild(s);
    host.setAttribute('data-logo', '');
    host.setAttribute('data-logoed', '1');
  }

  function setIcon(host, src, fallbackName, lazy) {
    if (!host) return;
    host.setAttribute('data-logo', '');
    host.setAttribute('data-logoed', '1');
    if (!src) { if (fallbackName) markLetters(host, fallbackName); return; }
    var img = host.querySelector('img');
    if (!img) {
      host.textContent = '';
      img = document.createElement('img');
      img.className = 'lx-netimg';
      img.alt = '';
      if (lazy) { img.loading = 'lazy'; img.decoding = 'async'; }
      img.style.cssText = 'width:100%;height:100%;border-radius:50%;object-fit:cover';
      host.appendChild(img);
    }
    img.onerror = function () {
      if (!img.__lxRetried && /^\/lxapi\//.test(String(img.getAttribute('src') || ''))) {
        img.__lxRetried = 1;
        img.src = src + (src.indexOf('?') >= 0 ? '&' : '?') + 'r=' + Date.now();
        return;
      }
      if (img.parentNode) img.parentNode.removeChild(img);
      if (fallbackName) markLetters(host, fallbackName);
    };
    if (img.getAttribute('src') !== src) img.src = src;
    if (img.complete && !img.naturalWidth && img.getAttribute('src')) { img.onerror(); return; }
    if (host.__lxIconT) clearTimeout(host.__lxIconT);
    host.__lxIconT = setTimeout(function () {
      host.__lxIconT = 0;
      var cur = host.querySelector('img');
      if (!cur || cur.naturalWidth) return;
      if (cur.parentNode) cur.parentNode.removeChild(cur);
      if (fallbackName) markLetters(host, fallbackName);
    }, 6000);
  }

  // The design's own options are painted by stylesheet (XRPL: setting a background on the node itself is
  // a fight with the design's render loop). Also the closed chip, the receiving-address row and the "To"
  // pill, keyed on attributes that survive a rebuild of their contents.
  function paintOptionCss() {
    try {
      if (document.getElementById('lx-nnetbg')) return;
      var css = '';
      Object.keys(NET_FILE).forEach(function (n) {
        var u = netFile(n);
        if (!u) return;
        css += '.brd-opt[data-net="' + n + '"] .brd-ic{background:url(' + u + ') center/cover no-repeat !important;'
          + 'color:transparent !important}';
        css += '.brd-trigger[data-net="' + n + '"] .br-ic{background:url(' + u + ') center/cover no-repeat !important;'
          + 'color:transparent !important}'
          + '.brd-trigger[data-net="' + n + '"] .br-ic>*{display:none !important}';
        css += '[data-destnet="' + n + '"] .br-wallet.brw-in .br-ic{background:url(' + u + ') center/cover no-repeat !important;'
          + 'color:transparent !important}'
          + '[data-destnet="' + n + '"] .br-wallet.brw-in .br-ic>*{display:none !important}';
        css += '[data-destnet="' + n + '"] button.lx-s2pill .lx-s2ic{background:url(' + u + ') center/cover no-repeat !important}'
          + '[data-destnet="' + n + '"] button.lx-s2pill .lx-s2ic>*{display:none !important}';
      });
      // NOTHING IS OFFERED UNTIL IT HAS BEEN CHECKED FOR A ROUTE. The design's list (Stellar's CCTP and
      // LayerZero chains among it) is hidden until refreshDestinations() has run once.
      css += '.brd-opt[data-lxunreach]{display:none !important}'
        + 'html:not([data-lxbrdready]) .brd-opt{display:none !important}'
        + 'html:not([data-lxbrdready]) .brd-menu .lxx-brdwait{display:block}'
        + '.lxx-brdwait{display:none;padding:14px 16px;color:var(--text-soft);'
        + 'font:600 13px/1.4 "Hanken Grotesk",system-ui,sans-serif}';
      var st = document.createElement('style');
      st.id = 'lx-nnetbg';
      st.textContent = css;
      (document.head || document.documentElement).appendChild(st);
      try {
        var mn0 = document.querySelector('.brd-menu');
        if (mn0 && !mn0.querySelector('.lxx-brdwait')) {
          var w0 = document.createElement('div');
          w0.className = 'lxx-brdwait';
          w0.textContent = 'Loading networks…';
          mn0.insertBefore(w0, mn0.firstChild);
        }
      } catch (_) {}
    } catch (_) {}

    // The design's Paste button has nothing behind it (measured on XRPL); wired the way XRPL wires it.
    if (!window.__lxnBrPaste) {
      window.__lxnBrPaste = 1;
      window.addEventListener('click', function (e) {
        var t = e.target;
        var b = t && t.closest ? t.closest('.br-paste') : null;
        if (!b) return;
        e.preventDefault();
        e.stopPropagation();
        var inp = document.querySelector('.br-addr-in');
        if (!inp) return;
        function put(v) {
          v = String(v || '').trim();
          if (!v) return;
          inp.value = v;
          inp.dispatchEvent(new Event('input', { bubbles: true }));
          inp.dispatchEvent(new Event('change', { bubbles: true }));
        }
        if (!navigator.clipboard || !navigator.clipboard.readText) { inp.focus(); return; }
        navigator.clipboard.readText().then(put).catch(function () { inp.focus(); });
      }, true);
    }
    if (!window.__lxnAddrWatch) {
      window.__lxnAddrWatch = 1;
      ['input', 'change', 'paste'].forEach(function (ev) {
        document.addEventListener(ev, function (e) {
          var t = e.target;
          if (!t || !t.classList || !t.classList.contains('br-addr-in')) return;
          setTimeout(function () { try { gateReview(); } catch (_) {} }, 0);
        }, true);
      });
    }
    if (!window.__lxnNetStamp) {
      window.__lxnNetStamp = 1;
      window.addEventListener('click', function (e) {
        var o = e.target && e.target.closest ? e.target.closest('.brd-opt') : null;
        if (!o) return;
        var n = o.getAttribute('data-net');
        var trg = document.querySelector('.brd-trigger');
        if (n && trg && o.getAttribute('data-lxroute')) trg.setAttribute('data-net', n);
        if (n && o.getAttribute('data-lxroute')) document.documentElement.setAttribute('data-destnet', n);
      }, true);
    }
  }

  // An appended destination: the design's handler never sees a clone, so selection is done here.
  function selectChain(o) {
    var trg = $('.brd-trigger');
    if (!trg) return;
    var name = o.getAttribute('data-net');
    var nm = trg.querySelector('.nm');
    if (nm) nm.textContent = name;
    trg.classList.remove('is-empty');
    trg.setAttribute('data-net', name);
    document.documentElement.setAttribute('data-destnet', name);
    var ic = trg.querySelector('.br-ic');
    if (ic) {
      var img = o.querySelector('.brd-ic img');
      setIcon(ic, chainLogo(name) || (img ? img.getAttribute('src') : ''), name);
    }
    var dd = o.closest('.brd');
    if (dd) dd.classList.remove('open');
    DEST = null; QUOTE = null;
    paintSteps(); requote();
  }

  // ---- source side ---------------------------------------------------------------------------------
  function paintSource() {
    var me = addr();
    // `:not(.brd-trigger)`: the destination dropdown's closed state is also a .br-netchip.
    $$('.br-netchip:not(.brd-trigger)').forEach(function (c) {
      var nm = c.querySelector('.nm');
      if (nm && nm.textContent !== 'NEAR') nm.textContent = 'NEAR';
      setIcon(c.querySelector('.br-ic'), NEAR_LOGO, 'NEAR');
    });
    $$('.br-wallet').forEach(function (w) {
      if (w.classList.contains('brw-in')) return;          // the receiving address row, not ours
      var a = w.querySelector('.addr');
      if (a) a.textContent = me ? short(me) : 'Not connected';
      var img = w.querySelector('img');
      if (img && img.getAttribute('src') !== NEAR_LOGO) { img.src = NEAR_LOGO; img.alt = ''; }
    });
  }

  // THE WALLET'S BALANCES. FastNEAR's token index in one request (the same index the Wallet page reads),
  // plus native NEAR from the RPC through lxnSwap.balance, which takes off the storage the account must
  // keep; lxnSwap.maxSpend then leaves 0.05 NEAR behind for gas and the storage deposits this
  // transaction may carry. A failed read leaves the figure UNKNOWN (null), never zero.
  function loadBalances() {
    var me = addr();
    if (!me || !S()) { HOLD = {}; HOLD_ME = ''; NEAR_SPEND = null; NEAR_RAW = null; return Promise.resolve(); }
    var pNear = S().balance(me, 'near').then(function (raw) { NEAR_RAW = raw; NEAR_SPEND = S().maxSpend('near', raw); },
      function () { NEAR_SPEND = null; NEAR_RAW = null; });
    var pFt = fetch(FT_API + encodeURIComponent(me) + '/ft').then(function (r) {
      if (!r.ok) throw new Error('balances ' + r.status);
      return r.json();
    }).then(function (d) {
      var h = {};
      ((d && d.tokens) || []).forEach(function (t) {
        var b = String((t && t.balance) || '');
        if (t && t.contract_id && /^[0-9]+$/.test(b)) h[String(t.contract_id)] = b;
      });
      HOLD = h; HOLD_ME = me;
    }, function () { HOLD = {}; HOLD_ME = ''; });
    return Promise.all([pNear, pFt]);
  }
  // The raw balance of an asset, or null when it is not known.
  function balRaw(a) {
    if (!a) return null;
    if (a.native) return NEAR_SPEND;
    if (HOLD_ME !== addr()) return null;
    return HOLD[a.contract] != null ? HOLD[a.contract] : '0';
  }

  // Native NEAR first (when 1Click takes wNEAR), then every curated origin.
  function sourceAssets() {
    var out = [];
    // NOTHING UNTIL NEAR INTENTS' LIST IS IN. Before it only the Omni/Wormhole extras would be here, so the
    // first paint chose wNEAR and kept it once native NEAR arrived (measured on staging d29184f6).
    if (!TOKENS) return out;
    var w = ORIGINS.filter(function (o) { return o.contract === WNEAR; })[0];
    if (w) {
      out.push({ id: 'near', native: true, symbol: 'NEAR', name: 'NEAR', decimals: 24, contract: WNEAR,
        assetId: w.assetId, price: w.price, logo: NEAR_LOGO });
    }
    ORIGINS.forEach(function (o) {
      out.push({ id: o.contract, native: false, symbol: o.symbol, name: o.name || '', decimals: o.decimals,
        contract: o.contract, assetId: o.assetId, price: o.price, logo: o.logo || '' });
    });
    // Then the curated tokens only Omni or Wormhole can carry (no assetId: NEAR Intents is not a route).
    if (BRX()) {
      var have = {};
      out.forEach(function (a) { have[a.contract] = 1; });
      out = out.concat(BRX().extraSources(have));
    }
    return out;
  }

  // ---- destinations --------------------------------------------------------------------------------
  var PLACES = {};
  function buildPlaces() {
    PLACES = {};
    Object.keys(BY_CHAIN).forEach(function (c) {
      if (!NI_CHAIN[c]) return;
      var k = norm(NI_CHAIN[c]);
      PLACES[k] = { label: NI_CHAIN[c], ni: c };
    });
    // Chains Omni or Wormhole reach are places too (all of them are NEAR Intents chains today).
    if (BRX()) BRX().places().forEach(function (l) { var k = norm(l); if (!PLACES[k]) PLACES[k] = { label: l }; });
    return PLACES;
  }
  // EVERY ROUTE THAT CAN CARRY THIS ASSET THERE, NEAR Intents first: it is the route this page always had.
  // Omni and Wormhole only for what their baked tables say they carry (_tools/_nearbridgeroutes.js).
  function routesFor(src, key) {
    var p = PLACES[key];
    if (!src || !p) return [];
    var out = [];
    if (p.ni && BY_CHAIN[p.ni] && src.assetId) out.push('ni');
    if (BRX()) ['om', 'wh'].forEach(function (r) { if (BRX().can(r, src, p.label)) out.push(r); });
    return out;
  }
  function routeFor(src, key) { var r = routesFor(src, key); return r.length ? r[0] : ''; }
  // THE ROUTE THE PAGE INTENDS TO USE, which also decides what the reader is told arrives: NEAR Intents
  // delivers the chain's own asset, Omni and Wormhole a bridged copy of the token sent. The route that
  // will carry it once quoted; before that the reader's pick; before that the first.
  function curRoute() {
    var key = destChain(), rs = routesFor(SRC, key);
    if (!rs.length) return '';
    if (BEST && rs.indexOf(BEST) >= 0) return BEST;
    if (PICKED && PICKED_FOR === key && rs.indexOf(PICKED) >= 0) return PICKED;
    return rs[0];
  }
  function reachablePlaces() {
    var set = {};
    if (!SRC) return set;
    Object.keys(PLACES).forEach(function (k) { var r = routeFor(SRC, k); if (r) set[k] = r; });
    return set;
  }

  function wireDestinations() {
    var opts = $$('.brd-opt');
    if (!opts.length) return 0;
    var menu = opts[0].parentNode;
    buildPlaces();
    var have = {};
    opts.forEach(function (o) {
      var key = norm(o.getAttribute('data-net'));
      have[key] = 1;
      if (PLACES[key]) o.setAttribute('data-lxplace', key);
      else o.removeAttribute('data-lxplace');
    });
    Object.keys(PLACES).forEach(function (k) {
      if (have[k]) return;
      have[k] = 1;
      menu.appendChild(extraOption(opts[0], k, PLACES[k].label));
    });
    $$('.brd-opt', menu).sort(function (a, b) {
      return String(a.getAttribute('data-net')).localeCompare(String(b.getAttribute('data-net')));
    }).forEach(function (o) { menu.appendChild(o); });
    watchDest();
    return refreshDestinations();
  }

  // The inherited lx-cctp-css hides the chains Circle CCTP could not reach with !important; a stylesheet
  // outliving the layer whose decision it encoded (XRPL, 2026-10-12). The rule goes, scoped to that sheet.
  function dropStaleChainHides() {
    try {
      for (var i = 0; i < document.styleSheets.length; i++) {
        var sh = document.styleSheets[i];
        if (!sh.ownerNode || sh.ownerNode.id !== 'lx-cctp-css') continue;
        var rs; try { rs = sh.cssRules; } catch (_) { continue; }
        for (var j = rs.length - 1; j >= 0; j--) {
          var r = rs[j];
          if (!r.selectorText) continue;
          if (!/^\s*\.brd-opt\[data-net=/.test(r.selectorText)) continue;
          if (!/display\s*:\s*none/i.test(r.cssText)) continue;
          try { sh.deleteRule(j); } catch (_) {}
        }
      }
    } catch (_) {}
  }

  function refreshDestinations() {
    dropStaleChainHides();
    var reach = reachablePlaces();
    var shown = [];
    $$('.brd-opt').forEach(function (o) {
      var c = o.getAttribute('data-lxplace');
      if (c && reach[c]) {
        o.style.setProperty('display', 'flex', 'important');
        o.setAttribute('data-lxroute', reach[c]);
        o.removeAttribute('data-lxunreach');
        shown.push(o.getAttribute('data-net'));
      } else {
        o.style.setProperty('display', 'none', 'important');
        o.removeAttribute('data-lxroute');
        o.setAttribute('data-lxunreach', '1');
      }
    });
    window.__lxnBridgeNets = shown;
    try { if (shown.length) document.documentElement.setAttribute('data-lxbrdready', '1'); } catch (_) {}
    if (shown.length) enforceDest(reach);
    return shown.length;
  }

  function enforceDest(reach) {
    reach = reach || reachablePlaces();
    var trg = $('.brd-trigger'), nm = trg && trg.querySelector('.nm');
    if (!trg || !nm) return;
    var label = norm(nm.textContent || '');
    if (!label || trg.classList.contains('is-empty') || /select/i.test(nm.textContent || '')) return;
    var cur = destChain();
    if (cur && reach[cur]) return;
    nm.textContent = 'Select Network';
    trg.classList.add('is-empty');
    trg.removeAttribute('data-net');
    document.documentElement.removeAttribute('data-destnet');
    DEST = null; QUOTE = null;
    try { paintSteps(); } catch (_) {}
  }

  // The inherited lx-bridge2js writes the trigger for every .brd-opt and stops propagation; a capture
  // listener on window runs first and refuses an unreachable option.
  function blockUnreachableClicks() {
    if (window.__lxnDestBlock) return;
    window.__lxnDestBlock = 1;
    window.addEventListener('click', function (e) {
      if (!document.documentElement.getAttribute('data-lxbrdready')) return;
      var t = e.target;
      var opt = (t && t.closest) ? t.closest('.brd-opt') : null;
      if (!opt) return;
      if (opt.getAttribute('data-lxroute')) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    }, true);
  }

  // A NEW DESTINATION IS A NEW TRANSFER (XRPL, 2026-10-05): the address is chain-specific, so it and the
  // amount clear when the destination changes.
  var lastDest = null;
  function destChanged() {
    var trg = $('.brd-trigger'), nm = trg && trg.querySelector('.nm');
    var now = (trg && !trg.classList.contains('is-empty') && nm) ? norm(nm.textContent) : '';
    if (now === lastDest) return;
    var had = lastDest;
    lastDest = now;
    if (!had || !now) return;
    var ai = amtInput(); if (ai && ai.value) { ai.value = ''; }
    var ad = $('.br-addr-in'); if (ad && ad.value) { ad.value = ''; }
    QUOTE = null; BEST = ''; NOTE = { ni: '', om: '', wh: '' }; OMQ = null; WHQ = null;
    try { paintSourceUsd(); } catch (_) {}
    try { paintSteps(); setCta(); } catch (_) {}
    requote();
  }
  function watchDest() {
    blockUnreachableClicks();
    if (window.__lxnDestWatch) return;
    var trg = $('.brd-trigger');
    if (!trg || typeof MutationObserver !== 'function') return;
    window.__lxnDestWatch = 1;
    var pending = 0;
    var mo = new MutationObserver(function () {
      if (pending) return;
      pending = 1;
      setTimeout(function () {
        pending = 0;
        try { enforceDest(); } catch (_) {}
        try { destChanged(); } catch (_) {}
      }, 0);
    });
    mo.observe(trg, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'data-net'] });
  }

  function extraOption(tpl, chain, name) {
    var o = tpl.cloneNode(true);
    o.setAttribute('data-net', name);
    o.setAttribute('data-lxplace', chain);
    o.setAttribute('data-lxadded', '1');
    o.removeAttribute('style');
    o.style.setProperty('display', 'flex', 'important');
    var ic = o.querySelector('.brd-ic');
    if (ic) { ic.removeAttribute('style'); ic.textContent = ''; setIcon(ic, chainLogo(name), name); }
    var nm = o.querySelector('.brd-nm');
    if (nm) { nm.setAttribute('data-logoed', '1'); nm.textContent = name; }
    return o;
  }

  function destChain() {
    var trg = $('.brd-trigger'), tn = trg && trg.querySelector('.nm');
    if (!trg || trg.classList.contains('is-empty') || !tn) return null;
    var k = norm(tn.textContent), found = null;
    $$('.brd-opt').forEach(function (o) {
      if (found) return;
      if (norm(o.getAttribute('data-net')) === k) found = o.getAttribute('data-lxplace') || null;
    });
    return found;
  }
  function niId(key) { var p = PLACES[key]; return (p && p.ni) || null; }
  function placeLabel(key) { var p = PLACES[key]; return (p && p.label) || key || ''; }

  // ---- the destination asset picker ----------------------------------------------------------------
  // NATIVE, USDC AND USDT. NOTHING ELSE (RAZA 2026-10-04, XRPL; the same rule here).
  function destTokens(chain) {
    var all = (BY_CHAIN[chain] || []);
    var list = all.filter(function (t) {
      if (!t || !t.contractAddress) return true;
      var s = String(t.symbol || '').toUpperCase();
      return s === 'USDC' || s === 'USDT';
    });
    list.sort(function (a, b) {
      var an = a.contractAddress ? 1 : 0, bn = b.contractAddress ? 1 : 0;
      if (an !== bn) return an - bn;
      var ap = Number(a.price) || 0, bp = Number(b.price) || 0;
      if (ap !== bp) return bp - ap;
      return String(a.symbol).localeCompare(String(b.symbol));
    });
    var seen = {};
    return list.filter(function (t) {
      var k = String(t.symbol || '').toUpperCase();
      if (seen[k]) return false;
      seen[k] = 1;
      return true;
    });
  }

  // The full name under a ticker. Only for what is delivered natively or as one of the two stablecoins;
  // a bridged copy's name is not something to invent.
  var DEST_FULL = { ETH: 'Ether', BTC: 'Bitcoin', SOL: 'Solana', USDC: 'USD Coin', USDT: 'Tether USD',
    XRP: 'XRP', XLM: 'Stellar Lumens', BNB: 'BNB', AVAX: 'Avalanche', POL: 'Polygon', TRX: 'Tron',
    TON: 'Toncoin', ADA: 'Cardano', DOGE: 'Dogecoin', LTC: 'Litecoin', BCH: 'Bitcoin Cash', DASH: 'Dash',
    ZEC: 'Zcash', SUI: 'Sui', APT: 'Aptos', STRK: 'Starknet', MOVE: 'Movement', BERA: 'Berachain',
    MON: 'Monad', XPL: 'Plasma', OKB: 'OKB', xDAI: 'xDAI', HYPE: 'Hyperliquid' };

  // The destination column has no asset row in the design; it is CLONED from the source's (XRPL).
  function ensureDestRow(dst) {
    var have = dst.querySelector('.br-assetrow');
    if (have) {
      // THE STELLAR BASE SHIPS THIS ROW, with the design's mock in it ("XRP", "~ 92.0", "~ $92.00").
      // Cleared once, before anything else paints into it, so the mock can never be read as a quote.
      if (!have.__lxnInit) {
        have.__lxnInit = 1;
        var hv = have.querySelector('.br-amt .v'), hu = have.querySelector('.br-amt .usd');
        if (hv) hv.textContent = '—';
        if (hu) hu.textContent = '';
        var hn = have.querySelector('.br-asset .nm');
        if (hn && !DEST) hn.textContent = 'Select';
        [have, have.querySelector('.br-asset'), hn, have.querySelector('.br-asset .br-ic')].forEach(function (el) {
          if (el) { el.setAttribute('data-logo', ''); el.setAttribute('data-logoed', '1'); }
        });
      }
      return have.querySelector('.br-asset');
    }
    var s2 = $('.br-step[data-step="2"]');
    var src = s2 && s2.querySelectorAll('.br-side')[0];
    var srcRow = src && src.querySelector('.br-assetrow');
    if (!srcRow) return null;
    var srcLbl = src.querySelector('.br-amtrow');
    if (srcLbl) {
      var lbl = srcLbl.cloneNode(true);
      var bal = lbl.querySelector('.bal');
      if (bal && bal.parentNode) bal.parentNode.removeChild(bal);
      var first = lbl.querySelector('span');
      if (first) first.textContent = 'You get';
      dst.appendChild(lbl);
    }
    var row = srcRow.cloneNode(true);
    var amt = row.querySelector('.br-amt');
    if (amt) {
      ['.lx-balrow', 'img.lx-amt-keep', '.lx-amt-in'].forEach(function (sel) {
        var x = amt.querySelector(sel);
        if (x && x.parentNode) x.parentNode.removeChild(x);
      });
      var v = amt.querySelector('.v'), u = amt.querySelector('.usd');
      if (v) v.textContent = '—';
      if (u) u.textContent = '';
    }
    var as = row.querySelector('.br-asset');
    if (as) {
      var nm = as.querySelector('.nm');
      if (nm) nm.textContent = 'Select';
      var full = as.querySelector('.lx-s2full');
      if (full) full.textContent = '';
    }
    [row, as, as && as.querySelector('.nm'), as && as.querySelector('.br-ic')].forEach(function (el) {
      if (!el) return;
      el.setAttribute('data-logo', '');
      el.setAttribute('data-logoed', '1');
    });
    dst.appendChild(row);
    return as;
  }

  function setPickable(as, on) {
    if (!as) return;
    as.style.cursor = on ? 'pointer' : '';
    var cv = as.querySelector('.cv');
    if (cv) cv.style.display = on ? '' : 'none';
    as.classList.toggle('lx-s2pick', !!on);
  }

  // OMNI AND WORMHOLE DELIVER THE TOKEN THAT WAS SENT, as their own bridged copy: the chip names it and
  // whose copy it is, and is not a picker -- there is nothing else either route can deliver.
  var CARRIED_BY = { om: 'Bridged by Omni', wh: 'Wormhole-wrapped' };
  function paintCarried(as, r) {
    if (!SRC) return;
    var nm = as.querySelector('.nm');
    if (nm && nm.textContent !== SRC.symbol) {
      nm.textContent = SRC.symbol;
      nm.setAttribute('data-logo', '');
      nm.setAttribute('data-logoed', '1');
    }
    if (as.getAttribute('data-lxfull') !== CARRIED_BY[r]) as.setAttribute('data-lxfull', CARRIED_BY[r]);
    setIcon(as.querySelector('.br-ic'), rowLogo(SRC), SRC.symbol);
    setPickable(as, false);
  }

  function paintDestAsset(dst) {
    var key = destChain(), as = ensureDestRow(dst);
    if (!as || !key) return;
    // DEST is NEAR Intents' choice and is kept whichever route is in use, so its card can still quote
    // while another route is picked, and the choice is there again when it is picked back.
    var chain = routesFor(SRC, key).indexOf('ni') >= 0 ? niId(key) : null;
    var opts = chain ? destTokens(chain) : [];
    if (!chain) DEST = null;
    else if (!DEST || DEST.chain !== chain) DEST = opts[0] ? { chain: chain, token: opts[0] } : null;
    var cr = curRoute();
    if (cr === 'om' || cr === 'wh') { paintCarried(as, cr); return; }
    if (!DEST) return;
    var nm = as.querySelector('.nm');
    if (nm && nm.textContent !== DEST.token.symbol) {
      nm.textContent = DEST.token.symbol;
      nm.setAttribute('data-logo', '');
      nm.setAttribute('data-logoed', '1');
    }
    var full = (!DEST.token.contractAddress || /^USD[CT]$/i.test(DEST.token.symbol))
      ? (DEST_FULL[DEST.token.symbol] || '') : '';
    if (as.getAttribute('data-lxfull') !== full) as.setAttribute('data-lxfull', full);
    setIcon(as.querySelector('.br-ic'), tokenLogo(DEST.token, key), DEST.token.symbol);
    setPickable(as, opts.length > 1);
    if (!as.__lxnMenu) {
      as.__lxnMenu = 1;
      as.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); toggleDestMenu(as); });
    }
  }

  // Stellar's own #lx-br-amenu control, as XRPL reproduced it: appended to <body>, positioned from the
  // chip's rect so the step's slide transform cannot trap it.
  var AMENU_CSS = '.lx-br-amenu{background:var(--surface-2,#fff);border:1px solid var(--border,#ececef);border-radius:14px;box-shadow:0 18px 44px rgba(0,0,0,.28);padding:6px;font:inherit;color:var(--text,#0e0e10)}'
    + '.lx-amsearch{padding:4px 4px 6px}'
    + '.lx-amq{width:100%;box-sizing:border-box;background:var(--surface,#f6f7f9);border:1px solid var(--border,#ececef);border-radius:9px;color:var(--text,#0e0e10);font:inherit;font-size:16px;padding:8px 10px;outline:none}'
    + '.lx-amq::placeholder{color:var(--text-soft,#8a90a2)}'
    + '.lx-amq:focus{border-color:rgba(234,106,44,.55);box-shadow:0 0 0 3px rgba(234,106,44,.1)}'
    + '.lx-amlist{max-height:264px;overflow:auto}'
    + '.lx-br-amenu button{display:flex;align-items:center;gap:10px;width:100%;padding:8px 10px;border:0;border-radius:10px;background:transparent;color:inherit;font:inherit;cursor:pointer;text-align:left}'
    + '.lx-br-amenu button:hover{background:var(--surface,#f4f5f7)}'
    + '.lx-br-amenu .aic{width:26px;height:26px;border-radius:50%;overflow:hidden;display:inline-flex;flex:0 0 26px;background:var(--surface,#f0f1f4)}'
    + '.lx-br-amenu .aic img{width:100%;height:100%;object-fit:cover;display:block}'
    + '.lx-br-amenu .atx{display:flex;flex-direction:column;line-height:1.25;min-width:0}'
    + '.lx-br-amenu .anm{font-size:14px;font-weight:600}'
    + '.lx-br-amenu .aiss{font-size:11px;color:var(--text-soft,#8a90a2);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:220px}';
  function amenuCss() {
    if (document.getElementById('lx-br-amenu-css')) return;
    var st = document.createElement('style');
    st.id = 'lx-br-amenu-css';
    st.textContent = AMENU_CSS;
    document.head.appendChild(st);
  }
  function closeMenu() {
    var m = document.getElementById('lx-br-amenu');
    if (m && m.parentNode) m.parentNode.removeChild(m);
  }
  function placeMenu(m, as) {
    var r = as.getBoundingClientRect();
    var maxL = window.scrollX + document.documentElement.clientWidth - m.offsetWidth - 8;
    m.style.left = Math.max(window.scrollX + 8, Math.min(maxL, r.left + window.scrollX)) + 'px';
    m.style.top = (r.bottom + window.scrollY + 6) + 'px';
    setTimeout(function () {
      document.addEventListener('click', function away(e) {
        if (e.target && e.target.closest && e.target.closest('#lx-br-amenu')) return;
        closeMenu();
        document.removeEventListener('click', away, true);
      }, true);
    });
  }
  // One row builder for both pickers. Ticker and subtitle go in as TEXT: both come from 1Click's list or
  // from on-chain metadata, and either can carry markup.
  function menuRow(icon, iconName, title, sub, q, onPick) {
    var b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('data-q', String(q || '').toLowerCase());
    var ic = document.createElement('span');
    ic.className = 'aic';
    setIcon(ic, icon, iconName, true);
    var tx = document.createElement('span');
    tx.className = 'atx';
    tx.setAttribute('data-logo', ''); tx.setAttribute('data-logoed', '1');
    var nm = document.createElement('span');
    nm.className = 'anm';
    nm.setAttribute('data-logo', ''); nm.setAttribute('data-logoed', '1');
    nm.textContent = title;
    tx.appendChild(nm);
    if (sub) {
      var s = document.createElement('span');
      s.className = 'aiss';
      s.setAttribute('data-logoed', '1');
      s.textContent = sub;
      tx.appendChild(s);
    }
    b.appendChild(ic); b.appendChild(tx);
    b.addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
      try { onPick(); } finally { closeMenu(); }
    });
    return b;
  }

  function toggleDestMenu(as) {
    if (document.getElementById('lx-br-amenu')) { closeMenu(); return; }
    var key = destChain();
    var chain = key && curRoute() === 'ni' ? niId(key) : null;
    if (!chain) return;
    var opts = destTokens(chain);
    if (opts.length < 2) return;
    amenuCss();
    var m = document.createElement('div');
    m.id = 'lx-br-amenu';
    m.className = 'lx-br-amenu';
    m.setAttribute('data-lx-noswap', '');       // before it is appended: see noSwap()
    m.style.cssText = 'position:absolute;z-index:99999;min-width:236px;display:block';
    var listHost = document.createElement('div');
    listHost.className = 'lx-amlist';
    m.appendChild(listHost);
    document.body.appendChild(m);
    opts.forEach(function (t) {
      var c = String(t.contractAddress || '');
      var sub = c ? (c.length > 14 ? c.slice(0, 6) + '…' + c.slice(-4) : c) : 'Native';
      listHost.appendChild(menuRow(tokenLogo(t, key), t.symbol, t.symbol, sub, t.symbol, function () {
        DEST = { chain: chain, token: t };
        QUOTE = null;
        paintSteps(); requote();
      }));
    });
    placeMenu(m, as);
  }

  // ---- the source asset ----------------------------------------------------------------------------
  function paintSourceAsset() {
    var s2 = $('.br-step[data-step="2"]');
    var side = s2 && s2.querySelectorAll('.br-side')[0];
    var as = side && side.querySelector('.br-asset');
    if (!as) return;
    var list = sourceAssets();
    if (!list.length) return;
    var keep = SRC && list.filter(function (a) { return a.id === SRC.id; })[0];
    SRC = keep || list[0];
    var nm = as.querySelector('.nm');
    if (nm && nm.textContent !== SRC.symbol) {
      nm.textContent = SRC.symbol;
      nm.setAttribute('data-logo', '');
      nm.setAttribute('data-logoed', '1');
    }
    setIcon(as.querySelector('.br-ic'), rowLogo(SRC), SRC.symbol, false);
    // THE NAME UNDER THE TICKER IS THE TOKEN'S OWN (curated metadata), never a cross-chain dictionary's:
    // a ticker is not an identity. Always set, even when empty, so no dictionary is consulted.
    var full = SRC.native ? 'NEAR' : (SRC.name || '');
    if (as.getAttribute('data-lxfull') !== full) as.setAttribute('data-lxfull', full);
    setPickable(as, list.length > 1);
    if (!as.__lxnSrcMenu) {
      as.__lxnSrcMenu = 1;
      as.addEventListener('click', function (e) {
        if (sourceAssets().length < 2) return;
        e.preventDefault(); e.stopPropagation(); toggleSrcMenu(as);
      });
    }
  }

  function toggleSrcMenu(as) {
    if (document.getElementById('lx-br-amenu')) { closeMenu(); return; }
    var list = sourceAssets();
    if (list.length < 2) return;
    amenuCss();
    var m = document.createElement('div');
    m.id = 'lx-br-amenu';
    m.className = 'lx-br-amenu';
    m.setAttribute('data-lx-noswap', '');       // before it is appended: see noSwap()
    m.style.cssText = 'position:absolute;z-index:99999;min-width:236px;display:block';
    var sw = document.createElement('div');
    sw.className = 'lx-amsearch';
    var q = document.createElement('input');
    q.className = 'lx-amq'; q.type = 'text'; q.placeholder = 'Search asset or contract';
    q.spellcheck = false; q.autocomplete = 'off'; q.setAttribute('aria-label', 'Search assets');
    sw.appendChild(q);
    var listHost = document.createElement('div');
    listHost.className = 'lx-amlist';
    m.appendChild(sw); m.appendChild(listHost);
    document.body.appendChild(m);

    // Held first, by what they are worth; then the rest of the roster, held or not.
    var val = function (a) {
      var r = balRaw(a);
      if (r == null || r === '0') return -1;
      return Number(fromUnits(r, a.decimals)) * (Number(a.price) || 0);
    };
    var ordered = [list[0]].concat(list.slice(1).sort(function (a, b) { return val(b) - val(a); }));
    ordered.forEach(function (a) {
      var sub = a.native ? 'Native asset' : (a.contract.length > 22 ? a.contract.slice(0, 8) + '…' + a.contract.slice(-6) : a.contract);
      listHost.appendChild(menuRow(rowLogo(a), a.symbol, a.symbol, sub,
        a.symbol + ' ' + (a.name || '') + ' ' + a.contract, function () {
          SRC = a; QUOTE = null; BEST = ''; NOTE = { ni: '', om: '', wh: '' }; OMQ = null; WHQ = null;
          try { checkFee(); } catch (_) {}
          refreshDestinations();
          paintSteps(); requote();
        }));
    });
    var em = document.createElement('div');
    em.className = 'lx-amempty';
    em.setAttribute('data-logoed', '1');
    em.hidden = true;
    em.style.cssText = 'padding:14px 12px;font-size:13px;color:var(--text-soft)';
    em.textContent = 'No asset matches that.';
    listHost.appendChild(em);
    function filter() {
      var v = (q.value || '').trim().toLowerCase(), shown = 0;
      $$('button[data-q]', listHost).forEach(function (b) {
        var ok = !v || (b.getAttribute('data-q') || '').indexOf(v) >= 0;
        b.style.display = ok ? 'flex' : 'none';
        if (ok) shown++;
      });
      em.hidden = shown > 0;
    }
    q.addEventListener('input', filter);
    q.addEventListener('click', function (e) { e.stopPropagation(); });
    q.addEventListener('keydown', function (e) { e.stopPropagation(); });
    placeMenu(m, as);
    setTimeout(function () { try { q.focus(); } catch (_) {} }, 20);
  }

  // ---- the fee account ------------------------------------------------------------------------------
  // Is fees-lumoscore.near registered on the token being sent? lxnSwap.feeReady caches definite answers
  // and NEVER a failed read, so "could not ask" (null) is asked again on the next paint rather than
  // remembered as "not registered".
  function checkFee() {
    var a = SRC;
    if (!a || !S()) return;
    var c = a.contract;
    if (FEE_OK[c] === true || FEE_OK[c] === false) return;
    if (FEE_OK[c] === 'asking') return;
    FEE_OK[c] = 'asking';
    S().feeReady(c).then(function (ok) {
      FEE_OK[c] = (ok === true || ok === false) ? ok : null;
      try { paintSteps(); } catch (_) {}
    }, function () { FEE_OK[c] = null; });
  }
  function feeState() {
    if (!SRC) return null;
    var v = FEE_OK[SRC.contract];
    return (v === true || v === false) ? v : null;
  }

  // ---- quoting -------------------------------------------------------------------------------------
  // THE DESIGN SHIPS NO AMOUNT FIELD (XRPL): the source .br-amt .v is a static mock, so an <input> is
  // added inside it, with the inert <img> child that keeps the logo healer from eating the box.
  function amtInput() {
    var s2 = $('.br-step[data-step="2"]');
    var side = s2 && s2.querySelectorAll('.br-side')[0];
    var box = side && side.querySelector('.br-amt');
    if (!box) return null;
    if (!box.querySelector('img.lx-amt-keep')) {
      var keep = document.createElement('img');
      keep.className = 'lx-amt-keep';
      keep.alt = '';
      keep.setAttribute('aria-hidden', 'true');
      keep.style.cssText = 'position:absolute;width:0;height:0;opacity:0;pointer-events:none';
      box.insertBefore(keep, box.firstChild);
    }
    var v = box.querySelector('.v');
    if (!v) {
      box.removeAttribute('data-logo');
      box.style.background = '';
      box.style.boxShadow = '';
      v = document.createElement('div'); v.className = 'v';
      var u = document.createElement('div'); u.className = 'usd';
      box.appendChild(v); box.appendChild(u);
    }
    var inp = v.querySelector('.lx-amt-in');
    if (inp) return inp;
    v.textContent = '';
    inp = document.createElement('input');
    inp.className = 'lx-amt-in';
    inp.type = 'text';
    inp.inputMode = 'decimal';
    inp.autocomplete = 'off';
    inp.spellcheck = false;
    inp.placeholder = '0';
    inp.setAttribute('aria-label', 'Amount to bridge');
    inp.style.cssText = 'font:inherit;color:inherit;background:transparent;border:0;outline:none;'
      + 'padding:0;margin:0;width:100%;min-width:0;appearance:none';
    v.appendChild(inp);
    return inp;
  }
  function typedRaw() {
    var inp = amtInput();
    return inp ? String(inp.value || '').replace(/[^0-9.]/g, '') : '';
  }
  function amountNum() {
    var n = parseFloat(typedRaw());
    return isFinite(n) ? n : 0;
  }
  function cleanAmount(inp) {
    var raw = String(inp.value || '');
    var out = raw.replace(/[^0-9.]/g, '');
    var i = out.indexOf('.');
    if (i >= 0) out = out.slice(0, i + 1) + out.slice(i + 1).replace(/\./g, '');
    if (out !== raw) {
      var at = inp.selectionStart == null ? out.length : inp.selectionStart - (raw.length - out.length);
      inp.value = out;
      try { inp.setSelectionRange(Math.max(0, at), Math.max(0, at)); } catch (e) {}
    }
  }
  // The amounts that move, in raw units, all BigInt: gross (typed), LumosCore's fee (0.2% floored, the
  // same feeOf the swap uses) and net (what reaches the deposit account and what 1Click is quoted on).
  function amounts() {
    if (!SRC || !S()) return null;
    var g = toUnits(typedRaw(), SRC.decimals);
    if (!g || big(g) <= BigInt(0)) return null;
    var fee = S().feeOf(g);
    var net = (big(g) - big(fee)).toString();
    if (big(net) <= BigInt(0)) return null;
    return { gross: g, fee: fee, net: net };
  }

  function paintSourceUsd() {
    var s2 = $('.br-step[data-step="2"]');
    var side = s2 && s2.querySelectorAll('.br-side')[0];
    var u = side && side.querySelector('.br-amt .usd');
    if (!u) return;
    var amt = amountNum(), px = SRC && Number(SRC.price);
    var t = (amt && px > 0) ? ('~ $' + fmt(amt * px, 2)) : '';
    if (u.textContent !== t) u.textContent = t;
  }

  function ensureReviewRows() {
    var dst = $('[data-rv="dst"]');
    var host = dst && dst.parentElement && dst.parentElement.parentElement;
    if (!host || host.querySelector('[data-rv="fee"]')) return;
    [['route', 'Route'], ['fee', 'LumosCore fee'], ['eta', 'Estimated time']].forEach(function (p) {
      var r = document.createElement('div');
      r.className = 'r';
      var k = document.createElement('span');
      k.className = 'k';
      k.textContent = p[1];
      var v = document.createElement('span');
      v.className = 'v mono';
      v.setAttribute('data-rv', p[0]);
      v.textContent = '—';
      r.appendChild(k); r.appendChild(v);
      host.appendChild(r);
    });
  }
  function recipient() {
    var i = $('.br-addr-in');
    return i ? String(i.value || '').trim() : '';
  }

  var qSeq = 0, qTimer = null;
  function requote() {
    clearTimeout(qTimer);
    qTimer = setTimeout(runQuote, 350);
  }

  function runQuote() {
    var key = destChain(), routes = routesFor(SRC, key);
    QUOTE = null; BEST = ''; QUOTING = false;
    NOTE = { ni: '', om: '', wh: '' }; OMQ = null; WHQ = null;
    // A hand-picked route belongs to the destination it was picked on (XRPL).
    if (PICKED_FOR !== key) { PICKED = ''; PICKED_FOR = ''; }
    if (!routes.length) { paintQuote(null, ''); return; }
    var seq = ++qSeq;
    QUOTING = true;
    paintQuote(null, routes.length > 1 ? 'Comparing routes…' : 'Quoting…');
    var jobs = [];
    if (routes.indexOf('ni') >= 0) jobs.push(quoteNi(niId(key), seq));
    if (routes.indexOf('om') >= 0) jobs.push(quoteOm(key, seq));
    if (routes.indexOf('wh') >= 0) jobs.push(quoteWh(key));
    // One route refusing is ordinary and must not cost the reader another route's answer.
    Promise.all(jobs.map(function (p) { return p.catch(function () { return null; }); }))
      .then(function () { if (seq === qSeq) settle(); });
  }
  function answered(r) { return r === 'ni' ? !!QUOTE : r === 'om' ? !!OMQ : r === 'wh' ? !!WHQ : false; }
  // WHICH ROUTE CARRIES IT. A hand-picked route is used only if it answered, and is NOT swapped for
  // another when it did not (RAZA on XRPL, 2026-10-04: picking THORChain and watching the page move back
  // to NEAR Intents). Here a swap would be worse than a different price -- each route delivers a
  // different asset, so falling back would change what arrives. The pick's own reason is shown instead.
  // With nothing picked, the first route that answered, in routesFor's order.
  function settle() {
    QUOTING = false;
    var key = destChain(), rs = routesFor(SRC, key);
    BEST = '';
    if (PICKED && PICKED_FOR === key && rs.indexOf(PICKED) >= 0) BEST = answered(PICKED) ? PICKED : '';
    // NEAR INTENTS WAITING ON THE READER IS NOT NEAR INTENTS REFUSING. It cannot quote until there is a
    // wallet and an address; Omni can. Moving to Omni meanwhile would flip the asset on screen (ETH ->
    // Omni's NEAR) and flip it back the moment the address is typed. Measured on staging 644957c0.
    else if (rs[0] === 'ni' && !QUOTE && /^(Enter a destination|Connect a NEAR)/.test(NOTE.ni || '')) BEST = '';
    else rs.some(function (r) { if (answered(r)) { BEST = r; return true; } return false; });
    try { paintSteps(); } catch (_) {}
    paintQuote(BEST === 'ni' ? QUOTE : null, BEST ? '' : quoteReason());
  }
  // NEVER EMPTY (nibridge-route-click-blanked-the-note): paintQuote sets LAST_NOTE to whatever it is
  // handed, so every caller passes this rather than ''. The route in use speaks first.
  function quoteReason() {
    return NOTE[curRoute()] || NOTE.ni || NOTE.om || NOTE.wh
      || (LAST_NOTE && LAST_NOTE.indexOf('…') < 0 ? LAST_NOTE : '') || 'No route for this amount';
  }

  function quoteNi(chain, seq) {
    var n = amounts(), me = addr();
    if (!n || !DEST || !chain) return Promise.resolve();
    // 1Click wants a refund account even on a dry quote. With no wallet there is none, and a placeholder
    // that is a real NEAR account would be naming a stranger -- so pricing waits for the wallet.
    if (!me) { NOTE.ni = LAST_NOTE = 'Connect a NEAR wallet to get a quote'; return Promise.resolve(); }
    var to = recipient();
    if (!to) { NOTE.ni = LAST_NOTE = 'Enter a destination address'; return Promise.resolve(); }
    var ae = destAddrError(destChain(), to);
    if (ae) { NOTE.ni = LAST_NOTE = ae; return Promise.resolve(); }
    return fetch(API + '?op=quote', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        dry: true, originAsset: SRC.assetId, destinationAsset: DEST.token.assetId,
        amount: n.net, refundTo: me, recipient: to
      })
    }).then(function (r) { return r.json().then(function (j) { return { s: r.status, j: j }; }, function () { return { s: r.status, j: null }; }); })
      .then(function (res) {
        if (seq !== qSeq) return;
        if (res.s === 201 && res.j && res.j.quote) QUOTE = res.j.quote;
        else {
          NOTE.ni = upstreamNote(String((res.j && (res.j.error || res.j.message)) || 'No route for this amount'));
          LAST_NOTE = NOTE.ni;
        }
      })
      .catch(function () {
        if (seq !== qSeq) return;
        NOTE.ni = LAST_NOTE = 'NEAR Intents is not answering right now — try again shortly.';
      });
  }

  // OMNI prices the RELAY: the token arrives as itself, so what lands is what was sent (less LumosCore's
  // fee, floored to what the bridge carries) and the one unknown is the relayers' fee in NEAR. Asked
  // without a destination address too -- the fee depends on where, not on who.
  function quoteOm(key, seq) {
    var n = amounts(), me = addr(), label = placeLabel(key);
    if (!n || !SRC || !BRX()) return Promise.resolve();
    if (!me) { NOTE.om = 'Connect a NEAR wallet to get a quote'; return Promise.resolve(); }
    var to = recipient();
    var ae = to ? destAddrError(key, to) : '';
    if (ae) { NOTE.om = ae; return Promise.resolve(); }
    var carried = BRX().carried('om', SRC, label, n.net);
    if (big(carried) <= BigInt(0)) { NOTE.om = 'Too small for Omni Bridge to carry'; return Promise.resolve(); }
    return BRX().omQuote(SRC, label, carried, me, to).then(function (q) {
      if (seq !== qSeq) return;
      if (q.min && big(carried) < big(q.min)) { NOTE.om = 'Minimum ' + fmt(fromUnits(q.min, SRC.decimals), 6) + ' ' + SRC.symbol; return; }
      OMQ = { nativeFee: q.nativeFee, usd: q.usd, carried: carried };
    }, function (e) { if (seq === qSeq) NOTE.om = String((e && e.message) || 'Omni Bridge did not answer'); });
  }
  // WORMHOLE has nothing to ask: no relayer, so no fee, and the amount is floored to the 8 decimals it
  // carries. Its cost is the claim on the destination, in that chain's gas, which the panel says.
  function quoteWh(key) {
    var n = amounts();
    if (!n || !SRC || !BRX()) return Promise.resolve();
    var carried = BRX().carried('wh', SRC, placeLabel(key), n.net);
    if (big(carried) <= BigInt(0)) NOTE.wh = 'Too small for Wormhole to carry';
    else WHQ = { carried: carried };
    return Promise.resolve();
  }

  function paintQuote(q, note) {
    LAST_NOTE = q ? '' : String(note || '');
    var s2 = $('.br-step[data-step="2"]');
    var dst = s2 && s2.querySelectorAll('.br-side')[1];
    var am = dst && dst.querySelector('.br-amt');
    if (am) {
      var v = am.querySelector('.v'), u = am.querySelector('.usd');
      var recvUnit = function (n, dp, sym) { return '~ ' + fmt(n, dp) + (sym ? ' ' + sym : ''); };
      // AN INDICATIVE FIGURE WHILE THERE IS NO QUOTE (nibridge-estimate-is-not-a-quote): what reaches
      // the route, priced at the two prices 1Click publishes. Replaced by the solver's figure on a quote.
      var estimate = function () {
        if (!DEST || !DEST.token || !SRC) return null;
        var px = Number(SRC.price), dpx = Number(DEST.token.price);
        if (!(px > 0) || !(dpx > 0)) return null;
        var n = amounts();
        if (!n) return null;
        return { amt: Number(fromUnits(n.net, SRC.decimals)) * px / dpx, sym: DEST.token.symbol };
      };
      var cr = BEST || curRoute(), cq = cr === 'om' ? OMQ : cr === 'wh' ? WHQ : null;
      if (cr === 'om' || cr === 'wh') {
        // The token itself arrives, so the figure is exact -- no tilde -- and the bridge's own cost is
        // said under it.
        var n0 = amounts();
        var c0 = cq ? cq.carried : (n0 && BRX() ? BRX().carried(cr, SRC, placeLabel(destChain()), n0.net) : '');
        var vt2 = (c0 && big(c0) > BigInt(0)) ? (fmt(fromUnits(c0, SRC.decimals), 6) + ' ' + SRC.symbol) : '—';
        if (v && v.textContent !== vt2) v.textContent = vt2;
        var ut2 = cq ? (cr === 'om' ? ('+ ' + fmt(fromUnits(cq.nativeFee, 24), 4) + ' NEAR relayer fee')
          : ('claimed on ' + placeLabel(destChain()))) : (note || '');
        if (u && u.textContent !== ut2) u.textContent = ut2;
        if (u) u.classList.remove('lx-amtnote');
        paintReview(q); paintRoutePanel(); setCta();
        return;
      }
      var est = q ? null : estimate();
      var vt = q ? recvUnit(q.amountOutFormatted, 6, (DEST && DEST.token) ? DEST.token.symbol : '')
        : (est ? recvUnit(est.amt, 6, est.sym) : '—');
      if (v && v.textContent !== vt) v.textContent = vt;
      var ut = q ? ('~ $' + fmt(q.amountOutUsd, 2)) : (note || '');
      if (u && u.textContent !== ut) u.textContent = ut;
      if (u) u.classList.remove('lx-amtnote');
    }
    paintReview(q);
    paintRoutePanel();
    setCta();
  }

  function paintReview(q) {
    var n = amounts();
    var sym = SRC ? SRC.symbol : 'NEAR';
    var set = function (sel, txt) { var e = $(sel); if (e && e.textContent !== txt) e.textContent = txt; };
    // A FIGURE IS NOT ERASED WHILE ITS REPLACEMENT IS BEING FETCHED (XRPL).
    var keep = function (sel, txt) {
      if (QUOTING && !QUOTE) {
        var e0 = $(sel);
        if (e0 && e0.textContent && e0.textContent !== '—' && e0.textContent.indexOf('—') !== 0) return;
      }
      set(sel, txt);
    };
    set('[data-rv="send"]', (amountNum() > 0 ? fmt(typedRaw(), 8) : '0') + ' ' + sym);
    var cr = curRoute(), cq = cr === 'om' ? OMQ : cr === 'wh' ? WHQ : null, carriedR = cr === 'om' || cr === 'wh';
    if (carriedR) keep('[data-rv="recv"]', cq ? (fmt(fromUnits(cq.carried, SRC.decimals), 6) + ' ' + SRC.symbol) : ('— ' + SRC.symbol));
    else keep('[data-rv="recv"]', q ? (fmt(q.amountOutFormatted, 6) + ' ' + DEST.token.symbol)
      : ('— ' + (DEST && DEST.token ? DEST.token.symbol : '')));
    set('[data-rv="sendnet"]', 'NEAR');
    var trg = $('.brd-trigger'), tn = trg && trg.querySelector('.nm');
    set('[data-rv="recvnet"]', (trg && !trg.classList.contains('is-empty') && tn) ? tn.textContent : '—');
    set('[data-rv="src"]', addr() ? short(addr()) : '—');
    set('[data-rv="dst"]', recipient() ? short(recipient()) : '—');
    set('[data-rv="fee"]', n ? (fmt(fromUnits(n.fee, SRC.decimals), 8) + ' ' + sym + ' (' + (feeBps() / 100) + '%)') : '—');
    keep('[data-rv="eta"]', carriedR ? ROUTE_ETA[cr] : ((q && q.timeEstimate) ? ('~' + q.timeEstimate + 's') : '—'));
    // The bridge's own cost rides on the route row: the fee row is LumosCore's.
    keep('[data-rv="route"]', !BEST ? '—' : BEST === 'om' && OMQ
      ? ('Omni Bridge · +' + fmt(fromUnits(OMQ.nativeFee, 24), 4) + ' NEAR relayer fee')
      : BEST === 'wh' ? ('Wormhole · claim on ' + placeLabel(destChain())) : ROUTE_META[BEST].name);
    paintReviewLegs();
  }

  // Both icon slots on both review legs: the network mark and the asset mark. lx-bridge3js, the inherited
  // second writer of the network slots, is stripped at build.
  function paintReviewLegs() {
    var s3 = $('.br-step[data-step="3"]');
    if (!s3) return;
    var legs = s3.querySelectorAll('.br-rv-leg');
    if (legs.length < 2) return;
    var place = placeLabel(destChain());
    var carriedR = curRoute() === 'om' || curRoute() === 'wh';
    var recvSym = carriedR ? (SRC ? SRC.symbol : '') : ((DEST && DEST.token) ? DEST.token.symbol : '');
    var put = function (host, src, fallback) {
      if (!host) return;
      host.setAttribute('data-logo', '');
      host.setAttribute('data-logoed', '1');
      if (!src) { if (fallback) markLetters(host, fallback); return; }
      var img = host.querySelector('img.lx-rvimg');
      if (!img) {
        host.textContent = '';
        img = document.createElement('img');
        img.className = 'lx-rvimg';
        img.alt = '';
        img.style.cssText = 'width:100%;height:100%;border-radius:50%;object-fit:cover;display:block';
        host.appendChild(img);
      }
      if (img.getAttribute('src') !== src) img.src = src;
    };
    var slots = function (leg) {
      var all = leg.querySelectorAll('.v .ic');
      var net = leg.querySelector('.v .ic.lx-rvnet');
      var asset = null;
      for (var i = 0; i < all.length; i++) if (all[i] !== net) { asset = all[i]; break; }
      return { net: net, asset: asset };
    };
    var a = slots(legs[0]), b = slots(legs[1]);
    put(a.net, netFile('NEAR') || NEAR_LOGO, 'NEAR');
    put(a.asset, SRC ? rowLogo(SRC) : '', SRC ? SRC.symbol : '');
    put(b.net, place ? chainLogo(place) : '', place);
    put(b.asset, carriedR ? (SRC ? rowLogo(SRC) : '') : ((DEST && DEST.token) ? tokenLogo(DEST.token, destChain()) : ''), recvSym);
  }

  // ---- the ROUTE panel -----------------------------------------------------------------------------
  // One card per route that can carry this asset there. 1Click's own cut: 20 bps with the partner key, 25
  // without (Stellar's niFeeBps), read from whether the Function reports itself keyed.
  function niFeeBps() { return KEYED ? 20 : 25; }
  var NI_ETA = '~30 seconds';
  // Wormhole's mark ships in this repo's assets/networks (its W token's art; the CoinGecko proxy is
  // refused from Cloudflare, measured on staging 7097d750). Omni has no token and no mark we ship, so a
  // plain monogram rather than borrowing someone else's artwork -- and the same for Wormhole should the
  // file ever be missing from a build.
  function monogram(ch) {
    return 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">'
      + '<circle cx="16" cy="16" r="16" fill="#1d1d22"/><text x="16" y="21.5" text-anchor="middle" '
      + 'font-family="Georgia,serif" font-size="17" font-weight="700" fill="#fff">' + ch + '</text></svg>');
  }
  var ROUTE_META = {
    ni: { name: 'NEAR Intents', img: '/assets/tokens/ni/NEAR.png' },
    om: { name: 'Omni Bridge', img: monogram('Ω') },
    wh: { name: 'Wormhole', img: NET_HAVE.wormhole ? ('/assets/networks/wormhole.png?v=' + ICONV) : monogram('W') }
  };
  // A range, not a number: neither publishes one. Wormhole's guardians sign NEAR transfers in ~15 min.
  var ROUTE_ETA = { om: 'a few minutes', wh: '~15 min, then claim' };
  var GAS_CUR = { Ethereum: 'ETH', 'BNB Chain': 'BNB', Polygon: 'POL', Avalanche: 'AVAX', Arbitrum: 'ETH',
    Optimism: 'ETH', Base: 'ETH' };
  var SICON = {
    recv: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/></svg>',
    fee: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/></svg>',
    time: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>',
  };
  function esc2(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  // OVER THE BALANCE, as one answer the button, the banner and the card all give. Compared in raw units.
  // An unknown balance is not a pass (XRPL: a check that vanishes when its input is missing is worse than
  // none) -- it is simply not an over-balance; the wallet itself refuses a transfer it cannot fund.
  function overBalance() {
    var n = amounts(), b = balRaw(SRC);
    if (!n || b == null) return '';
    if (!(big(n.gross) > big(b))) return '';
    return 'More than your ' + SRC.symbol + ' balance';
  }
  function balFigure(raw, a) {
    var v = Number(fromUnits(raw, a.decimals));
    var dp = v >= 1000 ? 2 : 4, p = Math.pow(10, dp);
    return fmt(Math.floor(v * p) / p, dp) + ' ' + a.symbol;
  }
  function formBanner() {
    if (overBalance()) return 'Amount exceeds your balance (' + balFigure(balRaw(SRC), SRC) + ').';
    var dc = destChain();
    if (dc) { var ae = destAddrError(dc, recipient()); if (ae) return ae; }
    var rn = NOTE[curRoute()] || '';
    if (!QUOTING && !BEST && amounts() && dc && rn && !/^(Enter a destination|Connect a NEAR)/.test(rn)) return rn;
    return '';
  }
  function step2Err(msg) {
    var s2 = $('.br-step[data-step="2"]');
    var e = s2 && s2.querySelector('.br-errslot');
    if (!e) return;
    if ((e.textContent || '') === (msg || '')) return;
    e.textContent = msg || '';
    if (msg) e.setAttribute('data-err', msg); else e.removeAttribute('data-err');
  }

  function routeRows() {
    var key = destChain();
    if (!SRC || !key) return [];
    return routesFor(SRC, key).map(function (r) {
      var o = { route: r, meta: ROUTE_META[r], state: 'ok', recv: '', eta: '', error: '' };
      var bq = r === 'om' ? OMQ : r === 'wh' ? WHQ : null;
      if (r === 'ni' && QUOTE) {
        o.recv = fmt(QUOTE.amountOutFormatted, 6) + ' ' + ((DEST && DEST.token) ? DEST.token.symbol : '');
        if (QUOTE.timeEstimate != null) o.eta = '~' + QUOTE.timeEstimate + 's';
      } else if (bq) {
        o.recv = fmt(fromUnits(bq.carried, SRC.decimals), 6) + ' ' + SRC.symbol;
        o.eta = ROUTE_ETA[r];
      } else o.state = QUOTING ? 'wait' : 'none';
      if (o.state === 'none' && !amountNum()) o.state = 'idle';
      if (o.state === 'none') o.error = overBalance() || NOTE[r] || 'No quote for this amount.';
      return o;
    });
  }
  function routeFee(r) {
    var ours = (feeBps() / 100) + '%';
    if (r === 'om') return ours + ' + ' + (OMQ ? fmt(fromUnits(OMQ.nativeFee, 24), 4) + ' NEAR relayer fee' : 'a relayer fee in NEAR');
    if (r === 'wh') return ours + ' + gas to claim';
    return ours + ' + ' + (niFeeBps() / 100) + '% NEAR';
  }

  function paintRoutePanel() {
    var panel = $('.lx-brroute[data-lxroute]');
    if (!panel) return;
    var host = panel.querySelector('[data-lxroute-opts]');
    var stats = panel.querySelector('[data-lxroute-stats]');
    if (!host || !stats) return;
    var rows = routeRows();
    if (!rows.length) { panel.hidden = true; return; }
    panel.hidden = false;
    var shown = curRoute() || (rows[0] && rows[0].route) || '';
    var h = '';
    rows.forEach(function (o) {
      var sel = o.route === shown;
      var dis = o.state === 'none';
      // NOT `disabled` (XRPL, 2026-10-04): a route that cannot price this amount is still the chosen
      // route; data-lxnoquote carries the styling and the card says why.
      h += '<button type="button" class="lx-brr" data-lxroutepick="' + o.route + '"'
        + (dis ? ' data-lxnoquote="1" aria-disabled="true"' : '')
        + ' aria-pressed="' + (sel ? 'true' : 'false') + '">'
        + '<div class="lx-brr-top">'
        + '<span class="lx-brr-mark" data-logo="" data-logoed="1">'
        + '<img src="' + esc2(o.meta.img) + '" alt=""></span>'
        + '<span class="lx-brr-hd"><span class="lx-brr-nm" data-logoed="1">' + esc2(o.meta.name) + '</span>'
        + '</span>';
      if (sel && o.state === 'ok') h += '<span class="lx-brr-tag">In use</span>';
      h += '</div>';
      if (o.state === 'none' && o.error && o.error !== formBanner()) {
        h += '<div class="lx-brs-note" style="margin-top:0;padding-top:0">' + esc2(o.error) + '</div>';
      }
      h += '<' + '/button>';
    });
    if (host.innerHTML !== h) host.innerHTML = h;

    var cur = rows.filter(function (x) { return x.route === shown; })[0];
    var sh = '';
    if (cur) {
      var row = function (ic, k, v) {
        return '<div class="lx-brs-row"><span class="lx-brs-ic">' + SICON[ic] + '</span>'
          + '<span class="lx-brs-k">' + k + '</span><span class="lx-brs-v">' + esc2(v) + '</span></div>';
      };
      var place = placeLabel(destChain());
      var carriedR = cur.route === 'om' || cur.route === 'wh';
      var recvAsset = carriedR ? SRC.symbol : ((DEST && DEST.token) ? DEST.token.symbol : '—');
      var eta = cur.eta || (carriedR ? ROUTE_ETA[cur.route] : NI_ETA);
      // NAMES THE THIRD PARTY HOLDING THE FUNDS (memory note: "never held by us" stays true, but the copy
      // must say who does hold them, for the ~30 seconds the solver takes).
      var note = (recvAsset !== '—')
        ? ('Delivered as ' + recvAsset + ' to your address automatically — no claim, and no gas needed on '
           + place + '. NEAR Intents holds the transfer at its deposit account for the ~30 seconds it takes.')
        : 'Delivered straight to the address you gave — there is nothing to claim on the other side.';
      // WHOSE COPY ARRIVES, with its address, and what the reader has to do: nothing for Omni, a claim
      // with an EVM wallet for Wormhole. Both need more NEAR on hand for gas than a NEAR Intents deposit.
      if (cur.route === 'om') {
        var ot = BRX() && BRX().omTo(SRC, place);
        note = 'Arrives as Omni’s ' + SRC.symbol + ' on ' + place + (ot ? ' (' + short(ot.to) + ')' : '')
          + '. Omni’s relayers finish the transfer, paid by the fee in NEAR — nothing to claim. Keep about '
          + fmt(fromUnits(BRX().KEEP.om, 24), 2) + ' NEAR for gas.';
      } else if (cur.route === 'wh') {
        var wt = BRX() && BRX().whTo(SRC, place);
        note = 'Arrives as Wormhole-wrapped ' + SRC.symbol + ' on ' + place + (wt ? ' (' + short(wt.to) + ')' : '')
          + '. Nobody relays NEAR transfers on Wormhole: once its guardians sign (about 15 minutes) you claim it in'
          + ' Recent transactions below, with an EVM wallet holding a little ' + (GAS_CUR[place] || 'gas') + '.';
      }
      sh = row('recv', 'Receive', recvAsset)
        + row('fee', 'Bridge fee', routeFee(cur.route))
        + row('time', 'Estimated time', eta)
        + '<div class="lx-brs-note">' + esc2(note) + '</div>';
    }
    if (stats.innerHTML !== sh) stats.innerHTML = sh;
    stats.hidden = !sh;
  }

  // A CARD IS A CHOICE, kept for this destination. It is used only once it has answered (settle), and the
  // page repaints with its own reason when it has not -- never a blank one.
  document.addEventListener('click', function (e) {
    var b = e.target && e.target.closest && e.target.closest('[data-lxroutepick]');
    if (!b) return;
    e.preventDefault(); e.stopPropagation();
    var r = b.getAttribute('data-lxroutepick'), key = destChain();
    if (!r || !key || routesFor(SRC, key).indexOf(r) < 0) return;
    PICKED = r; PICKED_FOR = key;
    if (!QUOTING) BEST = answered(r) ? r : '';
    try { paintSteps(); } catch (_) {}
    paintQuote(BEST === 'ni' ? QUOTE : null, BEST ? '' : quoteReason());
  }, true);

  // ---- recent transactions -------------------------------------------------------------------------
  // Each send records itself under TX_KEY in this browser; recoverFromChain() adds the account's earlier
  // bridges from the chain, as the XRPL build does from its ledger.
  var TX_PER = 25, TX_PAGE = 1;
  function txRecords() {
    var list = [];
    try { list = JSON.parse(localStorage.getItem(TX_KEY) || '[]'); } catch (e) { list = []; }
    if (!Array.isArray(list)) list = [];
    // A hash this browser recorded wins over the recovered copy: it also knows what the quote promised.
    var have = {};
    list.forEach(function (r) { if (r && r.hash) have[r.hash] = 1; });
    (RECOVERED || []).forEach(function (r) { if (!have[r.hash]) list.push(r); });
    return list.filter(function (r) { return r && r.hash; })
      .map(function (r) {
        // A refunded or failed transfer delivered nothing: the quote's figure would read as received.
        var none = r.status === 'REFUNDED' || r.status === 'FAILED';
        return { at: r.at, hash: r.hash, sent: r.inAmt, sentSym: r.srcSym || '', recv: none ? null : r.out,
          recvSym: r.sym || '', place: r.route ? (r.chain || '') : (NI_CHAIN[r.chain] || ''), from: r.from || '', to: r.to || '',
          route: r.route || 'ni', status: r.status || '', claimTx: r.claimTx || '' };
      })
      .sort(function (a, b) { return (b.at || 0) - (a.at || 0); });
  }
  function txWhen(ts) {
    var s = Math.max(0, Math.round((Date.now() - (ts || 0)) / 1000));
    if (s < 60) return 'Just now';
    if (s < 3600) return Math.floor(s / 60) + ' min ago';
    if (s < 86400) return Math.floor(s / 3600) + ' hr ago';
    var d = Math.floor(s / 86400);
    return d + (d === 1 ? ' day ago' : ' days ago');
  }
  function txAmt(v, sym, place) {
    var n = (v === null || v === undefined || v === '') ? NaN : Number(v);
    var shown = isFinite(n) ? fmt(n, (n > 0 && n < 1) ? 8 : 6) : '—';
    var nu = place === 'NEAR' ? NEAR_LOGO : netFile(place);
    var a = (sym === 'NEAR') ? NEAR_LOGO : symLogo(sym);
    var badge = nu
      ? ('<img loading="lazy" decoding="async" src="' + esc2(nu) + '" alt="" style="position:absolute;'
        + 'right:-2px;bottom:-2px;width:14px!important;height:14px!important;min-width:0!important;'
        + 'border-radius:50%;object-fit:cover;display:block;box-shadow:0 0 0 2px var(--surface)">')
      : '';
    return '<span class="br-asschip">'
      + '<span class="br-ic lx-netic" data-logo="" data-logoed="1" style="position:relative;overflow:visible">'
      + (a ? ('<img loading="lazy" decoding="async" src="' + esc2(a) + '" alt=""'
        + ' style="width:100%;height:100%;border-radius:50%;object-fit:cover;display:block">') : '')
      + badge
      + '</span><span><span class="am">' + esc2(shown + ' ' + (sym || '')) + '</span>'
      + '<span class="nt">' + esc2(place || '') + '</span></span></span>';
  }
  var XP_ICON = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
    + 'stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"></path>'
    + '<path d="M10 14 21 3"></path><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h6">'
    + '</path></svg>';
  function txExplorer(hash) { return 'https://nearblocks.io/txns/' + encodeURIComponent(hash); }
  function txRoute(route, r) {
    var m = ROUTE_META[route] || ROUTE_META.ni;
    var img = route === 'om' || route === 'wh' ? m.img
      : (NET_HAVE.nearintents ? ('/assets/networks/nearintents.png?v=' + ICONV) : '');
    return '<span class="lx-buse-r">'
      + (img ? ('<img src="' + esc2(img) + '" alt="" '
        + 'style="width:18px;height:18px;border-radius:50%;object-fit:cover;display:inline-block;vertical-align:-4px;margin-right:6px">') : '')
      + '<span>' + esc2(m.name) + '</span></span>' + (r ? txState(r) : '');
  }
  // WHERE A BRIDGED TRANSFER HAS GOT TO, under the route's name. A Wormhole transfer the guardians have
  // signed is the reader's to claim, so that row carries the button.
  var CLAIMING = {}, CLAIM_ERR = {};
  var ST_CSS = 'display:block;margin-top:4px;font-size:12px;line-height:1.35;color:var(--text-soft)';
  function txState(r) {
    if (r.route === 'wh') {
      if (r.status === 'READY') {
        return '<button type="button" class="lx-whclaim" data-whclaim="' + esc2(r.hash) + '" style="display:inline-flex;'
          + 'align-items:center;margin-top:6px;padding:6px 11px;border-radius:9px;border:0;cursor:pointer;font:600 12.5px/1.2 inherit;'
          + 'background:var(--accent,#ea6a2c);color:#fff"' + (CLAIMING[r.hash] ? ' disabled' : '') + '>'
          + esc2(CLAIMING[r.hash] || ('Claim on ' + r.place)) + '</button>'
          + (CLAIM_ERR[r.hash] ? '<span style="' + ST_CSS + ';color:var(--danger,#e5484d)">' + esc2(CLAIM_ERR[r.hash]) + '</span>' : '');
      }
      if (r.status === 'SUCCESS') {
        var ex = r.claimTx && BRX() ? BRX().evmExplorer(r.place) : '';
        return '<span style="' + ST_CSS + '">' + (ex ? ('<a href="' + esc2(ex + '/tx/' + r.claimTx) + '" target="_blank" rel="noopener">Claimed</a>') : 'Claimed') + '</span>';
      }
      return '<span style="' + ST_CSS + '">Waiting for Wormhole’s guardians (~15 min)</span>';
    }
    if (r.route === 'om') {
      return '<span style="' + ST_CSS + '">' + (r.status === 'SUCCESS' ? 'Delivered' : r.status === 'FAILED' ? 'Failed'
        : 'Omni is delivering it') + '</span>';
    }
    return '';
  }
  var TX_HEAD = '<tr><th>Time</th><th>From</th><th>Source address</th><th>To</th>'
    + '<th>Destination address</th><th>Bridge used</th>'
    + '<th class="br-xph" aria-label="Explorer">Explorer</th></tr>';
  var TX_EMPTY = 'No bridge transfers from this browser yet. Bridge something and it will be listed here.';

  function paintTxs() {
    var all = txRecords();
    var pages = Math.max(1, Math.ceil(all.length / TX_PER));
    if (TX_PAGE > pages) TX_PAGE = pages;
    var slice = all.slice((TX_PAGE - 1) * TX_PER, TX_PAGE * TX_PER);
    var me = addr();
    var tbl = $('.br-table');
    if (tbl) {
      var thead = tbl.querySelector('thead');
      if (thead && thead.innerHTML !== TX_HEAD) thead.innerHTML = TX_HEAD;
      var tb = tbl.querySelector('tbody');
      if (tb) {
        var h = '';
        if (!all.length) {
          h = '<tr><td colspan="7" style="padding:26px 12px;text-align:center;color:var(--text-soft)">'
            + esc2(TX_EMPTY) + '</td></tr>';
        } else {
          slice.forEach(function (r) {
            var src = r.from || me;
            h += '<tr>'
              + '<td>' + esc2(txWhen(r.at)) + '</td>'
              + '<td>' + txAmt(r.sent, r.sentSym, 'NEAR') + '</td>'
              + '<td class="mono">' + (src ? ('<a class="lx-txaddr" href="https://nearblocks.io/address/'
                + encodeURIComponent(src) + '" target="_blank" rel="noopener">' + esc2(short(src)) + '</a>') : '—') + '</td>'
              + '<td>' + txAmt(r.recv, r.recvSym, r.place) + '</td>'
              + '<td class="mono">' + (r.to ? esc2(short(r.to)) : '—') + '</td>'
              + '<td class="lx-buse">' + txRoute(r.route, r) + '</td>'
              + '<td class="br-xp"><a class="br-xplink" href="' + esc2(txExplorer(r.hash))
              + '" target="_blank" rel="noopener" aria-label="View on NearBlocks" '
              + 'title="View this transaction on NearBlocks">' + XP_ICON + '</a></td>'
              + '</tr>';
          });
        }
        if (tb.innerHTML !== h) tb.innerHTML = h;
      }
      var wrap = tbl.parentNode;
      var pg = wrap && wrap.querySelector('.lx-txpager');
      if (pages > 1) {
        if (!pg) {
          pg = document.createElement('div');
          pg.className = 'lx-txpager';
          pg.style.cssText = 'display:flex;align-items:center;gap:8px;justify-content:flex-end;'
            + 'padding:12px 4px 0;font:400 13px/1 "Hanken Grotesk",system-ui,sans-serif;color:var(--text-soft)';
          wrap.appendChild(pg);
          pg.addEventListener('click', function (e) {
            var b = e.target.closest && e.target.closest('[data-txpage]');
            if (!b) return;
            e.preventDefault();
            TX_PAGE = Number(b.getAttribute('data-txpage')) || 1;
            paintTxs();
          });
        }
        var ph = '<span style="margin-right:auto">Showing ' + (((TX_PAGE - 1) * TX_PER) + 1) + '–'
          + Math.min(TX_PAGE * TX_PER, all.length) + ' of ' + all.length + '</span>';
        for (var i = 1; i <= pages; i++) {
          ph += '<button type="button" data-txpage="' + i + '" style="min-width:28px;height:28px;'
            + 'border-radius:8px;border:1px solid var(--border);cursor:pointer;font:inherit;'
            + 'background:' + (i === TX_PAGE ? 'var(--accent,#ea6a2c)' : 'transparent') + ';'
            + 'color:' + (i === TX_PAGE ? '#fff' : 'var(--text)') + '">' + i + '</button>';
        }
        if (pg.innerHTML !== ph) pg.innerHTML = ph;
      } else if (pg) pg.remove();
    }
    var host = $('.lx-brmhost');
    if (host) {
      var mh = '';
      if (!all.length) {
        mh = '<div style="padding:22px 12px;text-align:center;color:var(--text-soft);font-size:13.5px">'
          + esc2('No bridge transfers from this browser yet.') + '</div>';
      } else {
        slice.forEach(function (r) {
          mh += '<div class="brm-txc lx-brmtx">'
            + '<div class="brm-tr1"><span class="brm-tm">' + esc2(txWhen(r.at)) + '</span>'
            + '<a class="br-xplink" style="margin-left:auto" href="' + esc2(txExplorer(r.hash))
            + '" target="_blank" rel="noopener" title="View this transaction on NearBlocks">' + XP_ICON + '</a></div>'
            + '<div class="brm-flow">' + txAmt(r.sent, r.sentSym, 'NEAR')
            + '<span class="br-ar">→</span>' + txAmt(r.recv, r.recvSym, r.place) + '</div>'
            + (r.to ? ('<div class="brm-recv">To ' + esc2(short(r.to)) + ' · via ' + txRoute(r.route, r) + '</div>')
              : ('<div class="brm-recv">via ' + txRoute(r.route, r) + '</div>'))
            + '</div>';
        });
      }
      if (host.innerHTML !== mh) host.innerHTML = mh;
    }
  }
  window.__lxnPaintTxs = paintTxs;

  // THE BALANCE AND MAX MOVE INTO THE AMOUNT BOX (XRPL's brpolish.js). The step-2 stylesheet hides
  // .br-amtrow's children and positions .lx-balrow beside the box; on Stellar the CCTP layer made this
  // move, and that layer is stripped here, so without it the balance and MAX simply vanish.
  function moveBalance(src) {
    var amtBox = src.querySelector('.br-amt');
    var balEl = src.querySelector('.br-amtrow .bal');
    if (amtBox && balEl && !src.querySelector('.lx-balrow')) {
      var balrow = document.createElement('div');
      balrow.className = 'lx-balrow';
      balrow.appendChild(balEl);
      amtBox.appendChild(balrow);
    }
  }

  function paintSteps() {
    var s2 = $('.br-step[data-step="2"]');
    if (s2) {
      var sides = s2.querySelectorAll('.br-side'), src = sides[0], dst = sides[1];
      if (src) {
        moveBalance(src);
        var bal = src.querySelector('.bal');
        if (bal) {
          var mx = bal.querySelector('.max');
          var raw = balRaw(SRC);
          var txt = (raw != null && SRC ? fmt(fromUnits(raw, SRC.decimals), 6) + ' ' + SRC.symbol : '—') + ' ';
          var cur = '';
          [].slice.call(bal.childNodes).forEach(function (nd) { if (nd.nodeType === 3) cur += nd.nodeValue; });
          if (cur !== txt) {
            [].slice.call(bal.childNodes).forEach(function (nd) { if (nd.nodeType === 3) bal.removeChild(nd); });
            bal.insertBefore(document.createTextNode(txt), bal.firstChild);
          }
          if (mx) {
            if (mx.getAttribute('data-logo') != null) mx.removeAttribute('data-logo');
            if (mx.getAttribute('style') != null) mx.removeAttribute('style');
            mx.setAttribute('data-logoed', '1');
            if (!mx.classList.contains('lx-maxbtn')) mx.classList.add('lx-maxbtn');
            if (mx.textContent) mx.textContent = '';
          }
        }
        paintSourceAsset();
        amtInput();
        paintSourceUsd();
      }
      if (dst) paintDestAsset(dst);
    }
    ensureReviewRows();
    paintReview(QUOTE);
    paintRoutePanel();
    setCta();
    noSwap();
  }

  function gateReview() {
    var s2 = $('.br-step[data-step="2"]');
    var b = s2 && s2.querySelector('.br-next');
    if (!b) return;
    var why = '';
    try { why = blockReason() || ''; } catch (e) {}
    var a = s2.querySelector('.br-addr-in');
    var typed = a ? String(a.value || '').trim() : '';
    if (!why && !typed) why = 'Enter the receiving address';
    var ok = !why;
    if (b.disabled !== !ok) b.disabled = !ok;
    b.classList.toggle('lx-disabled', !ok);
    b.setAttribute('aria-disabled', ok ? 'false' : 'true');
    if (ok) b.removeAttribute('title'); else if (b.title !== why) b.title = why;
  }

  function ctaButton() {
    var marked = $('[data-lxni-cta]');
    if (marked) return marked;
    var b = $$('.br-next').filter(function (x) {
      return /^\s*(confirm|bridge|swap|transfers not)/i.test(x.textContent || '');
    })[0];
    if (b) b.setAttribute('data-lxni-cta', '1');
    return b || null;
  }

  // THE DESTINATION ADDRESS, checked before a signature for the chains whose address shape is a property
  // of the CHAIN (XRPL, 2026-10-12: a wrong-format address on an unrecoverable route). Everything else
  // stays presence-only; 1Click validates against the real chain.
  var EVM_DEST = { ethereum:1, arbitrum:1, base:1, optimism:1, polygon:1, avalanche:1, bnbchain:1,
    scroll:1, gnosis:1, berachain:1, monad:1, plasma:1, xlayer:1, abstract:1, hood:1, hyperliquid:1 };
  function destAddrError(chainKey, value) {
    var k = norm(chainKey), v = String(value || '').trim();
    if (!v) return '';
    if (EVM_DEST[k]) return /^0x[0-9a-fA-F]{40}$/.test(v) ? '' : ('Enter a valid 0x address for ' + placeLabel(chainKey));
    if (k === 'stellar') return /^G[A-Z2-7]{55}$/.test(v) ? '' : 'Enter a valid Stellar address (G...)';
    if (k === 'solana') return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v) ? '' : 'Enter a valid Solana address';
    if (k === 'xrpl') return /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(v) ? '' : 'Enter a valid XRP Ledger address (r...)';
    return '';
  }

  function blockReason() {
    if (!addr()) return 'Connect a NEAR wallet';
    if (!S()) return 'Loading…';
    var chain = destChain();
    if (!chain) return 'Choose a destination';
    if (!routesFor(SRC, chain).length) return (SRC ? SRC.symbol : 'This asset') + ' cannot reach ' + placeLabel(chain);
    var cr = curRoute();
    if (cr === 'ni' && !DEST) return 'Choose a destination asset';
    if (!amounts()) return 'Enter an amount';
    var ob = overBalance();
    if (ob) return ob;
    var fs = feeState();
    if (fs === false) return 'Bridging ' + SRC.symbol + ' is coming soon';
    if (!recipient()) return 'Enter a destination address';
    var addrBad = destAddrError(chain, recipient());
    if (addrBad) return addrBad;
    if (!answered(cr)) return QUOTING ? 'Quoting…' : (NOTE[cr] || LAST_NOTE || 'Waiting for a quote');
    if (fs !== true) return 'Checking the fee setup…';
    if (!BEST) return 'No route can deliver ' + (cr === 'ni' && DEST ? DEST.token.symbol : SRC.symbol) + ' to ' + placeLabel(chain) + '.';
    return gasShort(BEST);
  }

  // NEAR FOR THE BRIDGE'S GAS AND FEES, said before the wallet is asked (near-wallet-error-is-not-a-
  // verdict: HOT answers "User rejected the request" when it cannot cover the gas it reserves). Omni and
  // Wormhole attach far more gas than a NEAR Intents deposit. Checked again at send, on the real figures.
  function gasShort(r) {
    if ((r !== 'om' && r !== 'wh') || NEAR_RAW == null || !BRX()) return '';
    var n = amounts();
    if (!n) return '';
    var need = big(BRX().KEEP[r]);
    if (SRC.native) need += big(n.gross);
    if (r === 'om' && OMQ) need += big(OMQ.nativeFee);
    if (big(NEAR_RAW) >= need) return '';
    return 'Keep ' + fmt(fromUnits(need.toString(), 24), 3) + ' NEAR for this transfer and its gas';
  }

  // DO NOT CALL paintQuote() FROM HERE: it ends by calling setCta(), and that cycle once recursed until
  // the stack blew, silently, on production (nibridge-estimate-is-not-a-quote).
  function setCta() {
    step2Err(formBanner());
    gateReview();
    var b = ctaButton();
    if (!b || busy) return;
    var why = blockReason();
    var t = why || ('Bridge ' + fmt(typedRaw(), 8) + ' ' + ((SRC && SRC.symbol) || 'NEAR'));
    if (b.textContent !== t) b.textContent = t;
    if (why) {
      b.setAttribute('disabled', 'disabled');
      b.setAttribute('aria-disabled', 'true');
      b.style.opacity = '.55';
      b.style.pointerEvents = 'none';
    } else {
      b.removeAttribute('disabled');
      b.removeAttribute('aria-disabled');
      b.style.opacity = '';
      b.style.pointerEvents = '';
    }
  }
  function say(msg) {
    var b = ctaButton();
    if (b) b.textContent = msg;
  }

  // ---- the transaction -------------------------------------------------------------------------------
  // ONE transaction to the token's own contract (wrap.near for native NEAR), its actions in this order:
  //   [native only] storage_deposit for the sender on wrap.near, if not registered      10 TGas, min
  //   [native only] near_deposit(gross)                                                  10 TGas, gross
  //   storage_deposit for the 1Click deposit account, if not registered on the token     10 TGas, min
  //   ft_transfer(fees-lumoscore.near, fee, memo "lx:ni")                                30 TGas, 1 yocto
  //   ft_transfer(depositAddress, net)                                                   30 TGas, 1 yocto
  // Same receipt, so all or nothing. The fee account is NEVER registered from here (users do not pay for
  // our registration); a token it is not registered on cannot reach this function (blockReason).
  function storageOf(contract, account) { return S().callView(contract, 'storage_balance_of', { account_id: account }); }
  function storageMin(contract) {
    return S().callView(contract, 'storage_balance_bounds', {}).then(function (b) {
      var m = b && b.min != null ? String(b.min) : '';
      if (!/^[0-9]+$/.test(m)) throw new Error('This token did not say what registering costs.');
      return m;
    });
  }
  function buildTx(me, src, n, dep) {
    var c = src.contract;
    return Promise.all([
      S().feeReady(c),
      storageOf(c, dep),
      src.native ? storageOf(WNEAR, me) : Promise.resolve(true)
    ]).then(function (r) {
      if (r[0] !== true) throw new Error(r[0] === false ? ('Bridging ' + src.symbol + ' is not enabled yet.') : 'Could not check the fee setup — try again.');
      var needDep = !r[1], needMe = !r[2];
      var needMin = needDep || needMe;
      return (needMin ? storageMin(c) : Promise.resolve(null)).then(function (min) {
        var acts = [];
        var fn = function (methodName, args, tgas, deposit) {
          return { type: 'FunctionCall', params: { methodName: methodName, args: args, gas: String(tgas) + TGAS, deposit: String(deposit) } };
        };
        if (src.native) {
          if (needMe) acts.push(fn('storage_deposit', { account_id: me, registration_only: true }, 10, min));
          acts.push(fn('near_deposit', {}, 10, n.gross));
        }
        if (needDep) acts.push(fn('storage_deposit', { account_id: dep, registration_only: true }, 10, min));
        if (big(n.fee) > BigInt(0)) {
          acts.push(fn('ft_transfer', { receiver_id: S().feeAccount(), amount: n.fee, memo: 'lx:ni' }, 30, '1'));
        }
        acts.push(fn('ft_transfer', { receiver_id: dep, amount: n.net }, 30, '1'));
        return { signerId: me, receiverId: c, actions: acts, needDep: needDep, needMe: needMe };
      });
    });
  }
  function sign(tx) {
    if (!window.lxn || typeof window.lxn.wallet !== 'function') return Promise.reject(new Error('Connect a NEAR wallet first.'));
    return window.lxn.wallet().then(function (w) {
      if (!w) throw new Error('No NEAR wallet is connected.');
      var one = { signerId: tx.signerId, receiverId: tx.receiverId, actions: tx.actions };
      if (typeof w.signAndSendTransactions === 'function') {
        return w.signAndSendTransactions({ signerId: tx.signerId, transactions: [{ receiverId: tx.receiverId, actions: tx.actions }] });
      }
      if (typeof w.signAndSendTransaction === 'function') return w.signAndSendTransaction(one).then(function (r) { return [r]; });
      throw new Error('This wallet cannot sign transactions here.');
    });
  }
  function outcomeOf(res) {
    var arr = Array.isArray(res) ? res : (res ? [res] : []);
    var r = arr[arr.length - 1] || null;
    var st = r && r.status;
    var hash = (r && ((r.transaction && r.transaction.hash) || (r.transaction_outcome && r.transaction_outcome.id))) || '';
    var failed = !!(st && typeof st === 'object' && st.Failure);
    return { hash: String(hash || ''), failed: failed };
  }

  function send() {
    if (busy) return;
    var why = blockReason();
    if (why) return;
    if (BEST === 'om' || BEST === 'wh') { sendBridge(BEST); return; }
    busy = true;
    var me = addr(), src = SRC, dest = DEST, n = amounts(), to = recipient();
    var b = ctaButton();
    if (b) { b.style.pointerEvents = 'none'; b.style.opacity = '.7'; }
    say('Getting a firm quote…');
    // A LIVE quote, not the dry one on screen: the dry quote has no deposit address, and the address and
    // the amount must come from the same call.
    fetch(API + '?op=quote', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dry: false, originAsset: src.assetId, destinationAsset: dest.token.assetId,
        amount: n.net, refundTo: me, recipient: to })
    }).then(function (r) { return r.json().then(function (j) { return { s: r.status, j: j }; }, function () { return { s: r.status, j: null }; }); })
      .then(function (res) {
        var q = res.j && res.j.quote;
        if (res.s !== 201 || !q || !q.depositAddress) {
          throw new Error(upstreamNote(String((res.j && (res.j.error || res.j.message)) || 'Could not get a quote')));
        }
        // The deposit account must be a NEAR account; anything else is not something to ft_transfer to.
        if (!(window.lxn && window.lxn.validAccount ? window.lxn.validAccount(q.depositAddress) : /^[0-9a-f]{64}$/.test(q.depositAddress))) {
          throw new Error('NEAR Intents returned a deposit address this page does not recognise. Nothing was sent.');
        }
        // The quote must be for exactly what is about to be deposited.
        if (q.amountIn != null && String(q.amountIn) !== String(n.net)) {
          throw new Error('The firm quote did not match the amount. Nothing was sent — try again.');
        }
        say('Preparing the transaction…');
        return buildTx(me, src, n, q.depositAddress).then(function (tx) {
          say('Confirm the transfer in your wallet…');
          return sign(tx).then(function (out) { return { q: q, tx: tx, out: outcomeOf(out) }; });
        });
      })
      .then(function (r) {
        if (r.out.failed) throw new Error('The transfer failed on NEAR. Nothing was deposited.');
        if (r.out.hash) {
          fetch(API + '?op=submit', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ txHash: r.out.hash, depositAddress: r.q.depositAddress, nearSenderAccount: me })
          }).catch(function () {});
        }
        record(r, src, dest, me, to);
        say('Sent — confirming…');
        poll(r.q.depositAddress, 0);
      })
      .catch(function (e) {
        busy = false;
        var m = String((e && e.message) || 'Transfer failed');
        if (/reject|cancel|denied|closed/i.test(m)) m = 'Cancelled in the wallet — nothing was sent.';
        say(m);
        setTimeout(function () { busy = false; setCta(); }, 4000);
      });
  }

  // ---- Omni and Wormhole: sending, following, claiming ----------------------------------------------
  // The wallet's own words when it refuses (neardcl's walletErr): "rejected" is not proof the reader said
  // no, and with more than one transaction an earlier one may already have landed.
  function walletSaid(e, multi) {
    var m = String((e && e.message) || e || '').replace(/\s+/g, ' ').slice(0, 180);
    try { console.warn('[LumosCore bridge] wallet error:', e); } catch (x) {}
    if (multi) return 'The wallet stopped: "' + (m || 'no reason given') + '". A step may already have gone through — check your wallet activity before trying again.';
    return 'Nothing was sent. The wallet said: "' + (m || 'no reason given') + '".';
  }
  function signMany(txs) {
    if (!window.lxn || typeof window.lxn.wallet !== 'function') return Promise.reject(new Error('Connect a NEAR wallet first.'));
    return window.lxn.wallet().then(function (w) {
      if (!w) throw new Error('No NEAR wallet is connected.');
      if (typeof w.signAndSendTransactions === 'function') {
        return w.signAndSendTransactions({ signerId: txs[0].signerId, transactions: txs.map(function (t) {
          return { receiverId: t.receiverId, actions: t.actions };
        }) });
      }
      if (txs.length === 1 && typeof w.signAndSendTransaction === 'function') {
        return w.signAndSendTransaction({ signerId: txs[0].signerId, receiverId: txs[0].receiverId, actions: txs[0].actions })
          .then(function (r) { return [r]; });
      }
      throw new Error('This wallet cannot sign these transactions here.');
    }).catch(function (e) {
      var err = (e instanceof Error) ? e : new Error(String((e && e.message) || e || ''));
      err.lxnWallet = true;
      err.lxnMulti = txs.length > 1;
      throw err;
    });
  }
  // The outcome of the transaction that carries the transfer (by its receiver), not merely the last one.
  // ft_transfer_call answers with the amount the receiver KEPT: "0" means the bridge refused it and the
  // token handed it back.
  function outcomeFor(res, receiver) {
    var arr = Array.isArray(res) ? res : (res ? [res] : []);
    var hit = null;
    arr.forEach(function (x) { if (x && x.transaction && x.transaction.receiver_id === receiver) hit = x; });
    var o = outcomeOf(hit ? [hit] : arr);
    var sv = hit && hit.status && hit.status.SuccessValue;
    if (sv) { try { if (JSON.parse(atob(sv)) === '0') o.refused = true; } catch (_) {} }
    return o;
  }

  function sendBridge(r) {
    busy = true;
    var me = addr(), src = SRC, n = amounts(), to = recipient(), label = placeLabel(destChain());
    var name = ROUTE_META[r].name;
    var b = ctaButton();
    if (b) { b.style.pointerEvents = 'none'; b.style.opacity = '.7'; }
    var amt = { fee: n.fee, carried: BRX().carried(r, src, label, n.net) };
    say(r === 'om' ? 'Asking Omni for its fee…' : 'Preparing the transaction…');
    // Omni is asked again: the fee on screen may be minutes old, and it is paid in the same transaction.
    var built = r === 'om'
      ? BRX().omQuote(src, label, amt.carried, me, to).then(function (q) { return BRX().omBuild(me, src, label, amt, to, q.nativeFee); })
      : BRX().whBuild(me, src, label, amt, to);
    built.then(function (x) {
      return S().balance(me, 'near').then(function (raw) {
        var need = big(x.nearOut) + big(BRX().KEEP[r]);
        if (big(raw) < need) {
          throw new Error('This needs ' + fmt(fromUnits(need.toString(), 24), 3) + ' NEAR in the wallet (the transfer, '
            + name + '’s costs and gas); it holds ' + fmt(fromUnits(raw, 24), 3) + '. Nothing was sent.');
        }
        return x;
      });
    }).then(function (x) {
      say(x.txs.length > 1 ? ('Confirm the ' + x.txs.length + ' transactions in your wallet…') : 'Confirm the transfer in your wallet…');
      return signMany(x.txs).then(function (out) { return { x: x, o: outcomeFor(out, x.main) }; });
    }).then(function (res) {
      if (res.o.failed) throw new Error('The transfer failed on NEAR. Nothing was bridged.');
      if (res.o.refused) throw new Error(name + ' refused the transfer and the token returned it to your wallet (LumosCore’s 0.2% was not).');
      recordBr(r, res.o.hash, src, label, me, to, amt);
      say(r === 'om' ? 'Sent — Omni is delivering it' : 'Sent — claim it below once Wormhole signs (~15 min)');
      if (res.o.hash) follow(res.o.hash, 0);
      setTimeout(function () { busy = false; setCta(); resetAfterDelivery(); }, 5000);
    }).catch(function (e) {
      say(e && e.lxnWallet ? walletSaid(e, e.lxnMulti) : String((e && e.message) || 'Transfer failed'));
      setTimeout(function () { busy = false; setCta(); }, 6000);
    });
  }

  function txList() {
    try { var l = JSON.parse(localStorage.getItem(TX_KEY) || '[]'); return Array.isArray(l) ? l : []; } catch (e) { return []; }
  }
  function txFind(hash) { return txList().filter(function (x) { return x && x.hash === hash; })[0] || null; }
  function patchRec(hash, f) {
    try {
      var list = txList();
      list.forEach(function (x) { if (x && x.hash === hash) f(x); });
      localStorage.setItem(TX_KEY, JSON.stringify(list));
    } catch (e) {}
    try { paintTxs(); } catch (_) {}
  }
  function recordBr(r, hash, src, label, me, to, amt) {
    if (!hash) return;
    try {
      var list = txList();
      list.unshift({ at: Date.now(), hash: hash, route: r, inAmt: typedRaw(), srcSym: src.symbol,
        out: fromUnits(amt.carried, src.decimals), sym: src.symbol, chain: label, from: me, to: to, status: 'PENDING' });
      localStorage.setItem(TX_KEY, JSON.stringify(list.slice(0, 50)));
    } catch (e) {}
    try { paintTxs(); } catch (_) {}
  }
  // WHERE IT HAS GOT TO. Omni until its relayers finish; Wormhole until the guardians sign (then it is the
  // reader's to claim) and on until a claim lands, from here or anywhere else. Every 20 s for an hour, and
  // resumed on the next visit for anything under a week old that has not finished.
  var FOLLOWING = {};
  function follow(hash, tries) {
    var rec = txFind(hash);
    if (!rec || !BRX() || (tries === 0 && FOLLOWING[hash])) return;
    FOLLOWING[hash] = 1;
    if (tries > 180) { delete FOLLOWING[hash]; return; }
    var p = rec.route === 'om' ? BRX().omStatus(hash).then(function (st) { return { status: st }; }) : BRX().whStatus(hash);
    p.then(function (s) {
      if (s.status && (s.status !== rec.status || (s.claimTx && s.claimTx !== rec.claimTx))) {
        patchRec(hash, function (x) { x.status = s.status; if (s.claimTx) x.claimTx = s.claimTx; });
      }
      if (s.status === 'SUCCESS' || s.status === 'FAILED') { delete FOLLOWING[hash]; return; }
      setTimeout(function () { follow(hash, tries + 1); }, 20000);
    }, function () { setTimeout(function () { follow(hash, tries + 1); }, 30000); });
  }
  // A CLAIM ASKS WORMHOLESCAN AGAIN FIRST: the signed message is not stored, and the transfer may have
  // been claimed from somewhere else since the row was painted.
  function claim(hash) {
    var rec = txFind(hash);
    if (!rec || CLAIMING[hash] || !BRX()) return;
    CLAIM_ERR[hash] = '';
    var setS = function (s) { CLAIMING[hash] = s; try { paintTxs(); } catch (_) {} };
    var done = function (claimTx) { patchRec(hash, function (x) { x.status = 'SUCCESS'; if (claimTx) x.claimTx = claimTx; }); };
    setS('Checking…');
    BRX().whStatus(hash).then(function (s) {
      if (s.status === 'SUCCESS') { done(s.claimTx); return null; }
      if (!s.vaa) throw new Error('Wormhole has not signed this transfer yet — try again in a few minutes.');
      return BRX().whClaim(rec.chain, s.vaa, setS);
    }).then(function (res) {
      delete CLAIMING[hash];
      if (res && res.ok === true) done(res.hash);
      else if (res && res.ok === false) CLAIM_ERR[hash] = 'The claim transaction failed on ' + rec.chain + '.';
      else if (res) CLAIM_ERR[hash] = 'Submitted — ' + rec.chain + ' has not confirmed it yet.';
      try { paintTxs(); } catch (_) {}
    }).catch(function (e) {
      delete CLAIMING[hash];
      var m = String((e && e.message) || 'Claim failed');
      if (/^Already claimed/.test(m)) done('');
      else CLAIM_ERR[hash] = m;
      try { paintTxs(); } catch (_) {}
    });
  }

  function record(r, src, dest, me, to) {
    try {
      var list = JSON.parse(localStorage.getItem(TX_KEY) || '[]');
      if (!Array.isArray(list)) list = [];
      list.unshift({ at: Date.now(), hash: r.out.hash || ('dep:' + r.q.depositAddress), dep: r.q.depositAddress,
        inAmt: typedRaw(), srcSym: src.symbol, out: r.q.amountOutFormatted, sym: dest.token.symbol,
        chain: dest.chain, from: me, to: to, status: 'PENDING_DEPOSIT' });
      localStorage.setItem(TX_KEY, JSON.stringify(list.slice(0, 50)));
    } catch (e) {}
    try { paintTxs(); } catch (_) {}
  }

  function resetAfterDelivery() {
    try {
      var ai = amtInput(); if (ai) ai.value = '';
      QUOTE = null; BEST = ''; NOTE = { ni: '', om: '', wh: '' }; OMQ = null; WHQ = null;
      try { paintSourceUsd(); } catch (_) {}
      try { loadBalances().then(paintSteps); } catch (_) {}
      try { paintSteps(); setCta(); } catch (_) {}
      var back = $('.br-step[data-step="3"] .br-back[data-go="2"]') || $('.br-back[data-go="2"]');
      if (back) back.click();
    } catch (e) {}
  }
  function poll(dep, tries) {
    if (tries > 40) { busy = false; setCta(); return; }
    fetch(API + '?op=status&depositAddress=' + encodeURIComponent(dep))
      .then(function (r) { return r.json(); })
      .then(function (j) {
        var st = j && j.status;
        if (st === 'SUCCESS') {
          say('Delivered'); mark(dep, st); busy = false;
          setTimeout(function () { setCta(); resetAfterDelivery(); }, 5000);
          return;
        }
        if (st === 'REFUNDED' || st === 'FAILED') {
          say(st === 'REFUNDED' ? 'Refunded to your NEAR wallet' : 'Failed'); mark(dep, st); busy = false;
          setTimeout(setCta, 5000); return;
        }
        say(st === 'PROCESSING' ? 'Processing…' : 'Confirming…');
        setTimeout(function () { poll(dep, tries + 1); }, 4000);
      })
      .catch(function () { setTimeout(function () { poll(dep, tries + 1); }, 6000); });
  }
  function mark(dep, st) {
    try {
      var list = JSON.parse(localStorage.getItem(TX_KEY) || '[]');
      for (var i = 0; i < list.length; i++) if (list[i].dep === dep) list[i].status = st;
      localStorage.setItem(TX_KEY, JSON.stringify(list));
    } catch (e) {}
    try { paintTxs(); } catch (_) {}
  }

  // ---- boot ----------------------------------------------------------------------------------------
  function title(n) {
    try { document.title = 'Bridge from NEAR to ' + (n || 35) + ' Networks | LumosCore'; } catch (e) {}
  }

  // ---- history recovered from the chain -------------------------------------------------------------
  // A bridge from NEAR is ONE transaction from the user carrying two token transfers: the 0.2% fee to
  // FEE_ACCT (memo lx:ni) and the deposit to a 64-hex 1Click deposit account. NearBlocks lists an account's
  // token transfers with the other party and the transaction hash (CORS open, so each visitor spends their
  // own rate limit, not our Cloudflare IP's), which is enough to recognise that shape without reading
  // memos. 1Click's status for the deposit account then CONFIRMS it (no quote back means it was not ours)
  // and supplies the destination. A swap's fee transaction pairs FEE_ACCT with v2.ref-finance.near, so it
  // never matches. Native NEAR is wrapped in the same transaction: a wrap.near MINT there means "NEAR".
  // Not cached: a lookup that fails leaves the browser's own rows, never an empty history.
  var RECOVERED = [];
  var NB = 'https://api.nearblocks.io/v1/account/';
  var FEE_ACCT = 'fees-lumoscore.near';
  function nbPages(me, pages) {
    var all = [], cursor = '';
    function next(k) {
      if (k >= pages) return Promise.resolve(all);
      return fetch(NB + encodeURIComponent(me) + '/ft-txns?per_page=50' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''))
        .then(function (r) { if (!r.ok) throw new Error('nearblocks ' + r.status); return r.json(); })
        .then(function (j) {
          var rows = (j && Array.isArray(j.txns)) ? j.txns : [];
          all = all.concat(rows);
          cursor = j && j.cursor;
          return (rows.length === 50 && cursor) ? next(k + 1) : all;
        });
    }
    return next(0);
  }
  function bridgeTxs(me, events) {
    var by = {};
    events.forEach(function (e) {
      if (!e || e.affected_account_id !== me || !e.transaction_hash || !e.ft) return;
      if (e.outcomes && e.outcomes.status === false) return;
      (by[e.transaction_hash] = by[e.transaction_hash] || []).push(e);
    });
    var out = [];
    Object.keys(by).forEach(function (h) {
      var fee = null, dep = null, mint = false;
      by[h].forEach(function (e) {
        var d = String(e.delta_amount || '');
        if (e.cause === 'MINT' && e.ft.contract === 'wrap.near') mint = true;
        if (d.charAt(0) !== '-') return;
        if (e.involved_account_id === FEE_ACCT) fee = e;
        else if (/^[0-9a-f]{64}$/.test(e.involved_account_id || '')) dep = e;
      });
      if (!fee || !dep || fee.ft.contract !== dep.ft.contract) return;
      var dec = +dep.ft.decimals || 0;
      var gross = (Number(String(fee.delta_amount).slice(1)) + Number(String(dep.delta_amount).slice(1))) / Math.pow(10, dec);
      out.push({ hash: h, dep: dep.involved_account_id, at: Math.floor(Number(dep.block_timestamp) / 1e6),
        inAmt: gross, srcSym: (mint && dep.ft.contract === 'wrap.near') ? 'NEAR' : (dep.ft.symbol || ''), from: me });
    });
    return out.sort(function (a, b) { return b.at - a.at; });
  }
  function recoverFromChain() {
    var me = addr();
    if (!me || !TOKENS || recoverFromChain.busyFor === me) return;
    recoverFromChain.busyFor = me;
    nbPages(me, 2).then(function (events) {
      return bridgeTxs(me, events).slice(0, 20).reduce(function (p, c) {
        return p.then(function (acc) {
          return fetch(API + '?op=status&depositAddress=' + encodeURIComponent(c.dep))
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (j) {
              var qr = j && j.quoteResponse, req = qr && qr.quoteRequest;
              if (!req || !req.destinationAsset) return acc;
              var t = null;
              for (var i = 0; i < TOKENS.length; i++) if (TOKENS[i].assetId === req.destinationAsset) { t = TOKENS[i]; break; }
              var sd = j.swapDetails || {}, q = qr.quote || {};
              c.out = sd.amountOutFormatted || q.amountOutFormatted || null;
              c.sym = t ? t.symbol : '';
              c.chain = t ? t.blockchain : '';
              c.to = req.recipient || '';
              c.status = j.status || '';
              acc.push(c);
              return acc;
            })
            .catch(function () { return acc; });
        });
      }, Promise.resolve([]));
    }).then(function (rows) {
      if (addr() !== me) return;
      RECOVERED = rows || [];
      try { paintTxs(); } catch (_) {}
    }).catch(function (e) {
      try { console.warn('[bridge] history from chain unavailable: ' + ((e && e.message) || e)); } catch (_) {}
    }).then(function () { recoverFromChain.busyFor = ''; });
  }

  // THE CHAIN RENAMER MUST NOT TOUCH WHAT THIS FILE WRITES (RAZA 2026-10-30: "why is near itself in the
  // destination dropdown list"). The design was drawn for Aptos, and lx-mc walks every text node renaming
  // "Aptos" to the chain in use and the ticker "APT" to NEAR -- including the real Aptos destination, which
  // read "NEAR" beside Aptos's own logo, and every APT figure an Aptos transfer would show. lx-mc skips
  // anything inside [data-lx-noswap], so the bridge's own areas carry it. Set before the destinations are
  // appended: the renamer's observer sees each new option as it lands.
  //
  // THE WHOLE CARD, NOT A LIST OF ITS PARTS (RAZA 2026-10-30: "it keeps freezing"). Picking Aptos made
  // lx-brstep2 write "Make sure the address is on Aptos" into step 2 -- outside the parts listed here -- the
  // renamer made it "on NEAR", lx-brstep2's own observer wrote "Aptos" back, and the two traded the node in
  // an endless microtask loop: the tab froze. Every .br-step and the card around them are ours.
  function noSwap() {
    $$('.br-card, .br-step, .br-steps, .br-netbox, .lx-brroute, .br-table, .lx-brmhost, .lx-br-amenu').forEach(function (el) {
      if (!el.hasAttribute('data-lx-noswap')) el.setAttribute('data-lx-noswap', '');
    });
  }

  function load() {
    if (!$('.br-netbox') && !$('.br-steps')) return;
    noSwap();
    paintSource();
    try { document.documentElement.classList.add('lx-chainready'); } catch (e) {}
    paintOptionCss();
    try { paintTxs(); } catch (_) {}
    try {
      txList().forEach(function (r) {
        if (r && r.hash && (r.route === 'om' || r.route === 'wh') && r.status !== 'SUCCESS' && r.status !== 'FAILED'
            && Date.now() - (r.at || 0) < 7 * 86400000) follow(r.hash, 0);
      });
    } catch (_) {}

    if (!window.__lxnNiWired) {
      window.__lxnNiWired = 1;
      window.addEventListener('click', function (e) {
        var t = e.target;
        if (!t || !t.closest) return;
        var cl = t.closest('[data-whclaim]');
        if (cl) { e.preventDefault(); e.stopPropagation(); claim(cl.getAttribute('data-whclaim')); return; }
        var hit = t.closest('[data-lxni-cta]');
        if (hit && !blockReason()) { e.preventDefault(); e.stopPropagation(); send(); return; }
        var added = t.closest('.brd-opt[data-lxadded]');
        if (added) {
          e.preventDefault(); e.stopPropagation();
          if (added.getAttribute('data-lxroute')) selectChain(added);
          return;
        }
        // Re-quote after anything that may have changed the form -- but not after a route card, which
        // repaints itself and must not throw away a quote it already has (XRPL).
        if (!t.closest('[data-lxroutepick]') && t.closest('.brd-opt, .br-step, .brd, .br-back')
            && !t.closest('.max') && !t.closest('[data-lxni-cta]')) {
          setTimeout(function () { paintSteps(); }, 30);
          setTimeout(paintSteps, 250);
        }
        if (t.closest('.br-step[data-step="2"] .max')) {
          e.preventDefault(); e.stopPropagation();
          var inp = amtInput(), raw = balRaw(SRC);
          if (inp && raw != null && SRC) {
            // Native NEAR's figure already has the 0.05 NEAR gas-and-storage keep taken off (maxSpend).
            inp.value = fromUnits(raw, SRC.decimals);
            QUOTE = null; paintSourceUsd(); paintReview(null); setCta(); requote();
          }
          return;
        }
      }, true);
      window.addEventListener('input', function (e) {
        var t = e.target;
        if (!t || !t.classList) return;
        if (t.classList.contains('lx-amt-in')) {
          cleanAmount(t);
          QUOTE = null; paintSourceUsd(); paintReview(null); setCta(); requote();
          return;
        }
        if (t.classList.contains('br-addr-in')) {
          QUOTE = null; paintReview(null); setCta(); requote();
        }
      }, true);
      // A wallet connected or switched in another tab, or by the connect modal on this one.
      window.addEventListener('storage', function (e) {
        if (e && /^lumos\.(address|chain|network)$/.test(e.key || '')) {
          loadBalances().then(function () { paintSource(); paintSteps(); requote(); });
        }
      });
    }

    function regFetch(url, tries) {
      return fetch(url)
        .then(function (r) { return r.json(); })
        .then(function (j) { if (j && j.ok) return j; throw new Error('registry not ok'); })
        .catch(function () {
          if (tries > 1) {
            return new Promise(function (go) { setTimeout(go, 700); })
              .then(function () { return regFetch(url, tries - 1); });
          }
          return null;
        });
    }
    regFetch(API + '?op=tokens', 3).then(function (d) {
      if (!(d && d.ok && Array.isArray(d.tokens) && Array.isArray(d.origins))) {
        say('NEAR Intents is unavailable — reload to try again');
        try { console.warn('[bridge] NEAR Intents token list unavailable after 3 attempts'); } catch (e) {}
        return;
      }
      TOKENS = d.tokens; KEYED = !!d.keyed; ORIGINS = d.origins;
      BY_CHAIN = {};
      TOKENS.forEach(function (t) { if (NI_CHAIN[t.blockchain]) (BY_CHAIN[t.blockchain] = BY_CHAIN[t.blockchain] || []).push(t); });
      window.__lxnNiChains = Object.keys(BY_CHAIN);
      window.__lxnNiOrigins = ORIGINS.map(function (o) { return o.symbol; });
      try { paintSourceAsset(); checkFee(); title(wireDestinations()); paintSteps(); setCta(); } catch (_) {}
      try { recoverFromChain(); } catch (_) {}
      return loadBalances().then(function () { paintSource(); paintSteps(); });
    });
    loadBalances().then(function () { try { paintSteps(); } catch (_) {} });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load);
  else load();
  window.__lxnNiReload = load;
})();
