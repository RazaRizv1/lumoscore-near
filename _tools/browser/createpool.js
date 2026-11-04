// Create Pool on NEAR: a Rhea (v2.ref-finance.near) simple pool, driven from the design's own
// #createPoolModal. Ported from the XRPL fork's browser/createpool.js, with NEAR's money logic.
//
// RAZA 2026-10-28, comparing the two dialogs: "1- Add 'AMM' into text after 'Initialize a new liquidity
// pool on Near' same like stellar. 2- remove 'Pool creation on Near is coming soon' from the bottom of the
// pop up and update it to 'Create Pool' same like Stellar. 3- I am also not able to select Asset 1 nor
// Asset 2 for Near. 4- Remove 'trading fee' below 'Initial pool price' 5- Show the amount of Network fee at
// the right too e.g. '≈0.000001 NEAR' same as shown on Stellar."
//
// This file previously HELD the dialog disabled, because nothing on the build could create a NEAR pool.
// That is no longer true: browser/nearmint.js has created pools on mainnet since 2026-10-21 (nspear.near,
// pool 8978) with add_simple_pool + add_liquidity, and the deposits below are the figures measured on that
// launch. So the dialog is wired to the same sequence rather than relabelled around it.
//
// NO NEW UI. The asset pickers, dropdowns, balance lines, MAX, summary rows and buttons are the design's.
// Dropdown items carry `.ad-item.lx-cpitem` -- the class Stellar's layer gives its real items, and the only
// one the inherited stylesheet lets through (`.ad-item:not(.lx-cpitem){display:none!important}` hides the
// design's mock rows, which are Stellar's assets: KALE, yXLM, AQUA). One status line is added under the
// summary, the same pattern every other NEAR dialog on this build uses to say what happened.
//
// WHAT IT DEPENDS ON. Only window.lxnCore, which is the one layer present on all eight pages that carry
// this dialog (checked 2026-10-28: the dashboard, Pools and $LUMOS pages, desktop/mobile/dark). nearswap
// and neardcl are on the dashboard pages only and nearlaunch on none of them, so the constants and the
// signing are HERE rather than imported -- the same call browser/neardcl.js made for the same reason. Every
// figure is carried with the comment that says where it was measured, so the two copies cannot drift
// silently: nearlaunch.js is the source of truth and is cited on each line.
//
// THE SEQUENCE, which is nearmint.js steps 2 and 3 with the token factory removed:
//   1. POOL       for each side that Rhea is not registered on:
//                     token.storage_deposit({account_id: Rhea, registration_only: true}) deposit = that
//                     token's storage_balance_bounds.min, READ LIVE (0.00125 for a standard FT).
//                 Rhea: [storage_deposit({account_id: me, registration_only: false}) when my Rhea account
//                     is new or short of room for the two tokens],
//                     [register_tokens({token_ids}) 1 yocto, when a side is not on Rhea's whitelist --
//                     without it Rhea answers ERR_TOKEN_NOT_WHITELISTED to the deposit],
//                     add_simple_pool({tokens, fee: 30}) 0.05 NEAR, excess refunded.
//   2. LIQUIDITY  wrap.near: [storage_deposit for me if unregistered], [near_deposit when a side is native
//                     NEAR], ft_transfer_call({receiver_id: Rhea, amount, msg: ""})
//                 the other token: ft_transfer_call({receiver_id: Rhea, amount, msg: ""})
//                 Rhea: add_liquidity({pool_id, amounts, min_amounts: 99.9%}) 0.01 NEAR
//
// TWO APPROVALS, NOT ONE. The pool id is only known once add_simple_pool has run, and it cannot be
// predicted (get_number_of_pools races every other pool creator on Rhea) -- the same reason nearmint.js
// gives for its three. When the pair already has a pool there is one approval, because step 1 is skipped.
//
// FEE 30 BPS = 0.3%. Rhea's most common simple-pool fee, what nearmint.js creates with, and the same rate
// Stellar's protocol fixes every one of its AMM pools at -- so the two chains charge a pool the same. The
// summary row that states it is REMOVED (RAZA's point 4), which is also what lumoscore.com does.
//
// RHEA ALLOWS DUPLICATE POOLS, AND THE XRP LEDGER DOES NOT. On XRPL a second AMM for a pair is rejected by
// the ledger (tecDUPLICATE), so that fork can treat "a pool exists" as a fact and deposit into it. Rhea
// would happily create a second [A, B] pool and split the liquidity between them. So an existing pool is
// LOOKED FOR and, when found, used -- and when the lookup itself fails it says so and refuses, rather than
// treating "could not ask" as "there is none" and fragmenting a live pool. Same rule as the balances below.
(function () {
  if (window.__lxnCreatePool) return;
  window.__lxnCreatePool = 1;

  // The amount field spills out of the dialog without this -- `.asset-amt` is an <input> in a flex row with
  // `flex:1 1 0`, and an input's default `min-width:auto` resolves to its intrinsic ~20-character width, so
  // it refuses to shrink and pushes itself past the panel. Carried from the XRPL fork, where RAZA hit it on
  // 2026-09-17: "its still breaking. the value is going out of the place".
  (function amtFits() {
    if (document.getElementById('lx-cpfit')) return;
    var st = document.createElement('style');
    st.id = 'lx-cpfit';
    st.textContent = '#createPoolModal .asset-amt{min-width:0}';
    (document.head || document.documentElement).appendChild(st);
  })();

  // ---- constants: every one of these is nearlaunch.js's, cited so the copies cannot drift --------------
  var REF = 'v2.ref-finance.near';                      // nearlaunch.js REF
  var WNEAR = 'wrap.near';                              // nearlaunch.js WNEAR
  var POOL_FEE_BPS = 30;                                // nearlaunch.js POOL_FEE_BPS -- 0.3%
  var REF_POOL_DEPOSIT = '50000000000000000000000';     // 0.05 NEAR, excess refunded  (nearlaunch.js)
  var REF_LIQ_DEPOSIT = '10000000000000000000000';      // 0.01 NEAR, excess refunded  (nearlaunch.js)
  var REF_ACCOUNT_NEW = '10000000000000000000000';      // 0.01 NEAR, a new Rhea account (nearlaunch.js)
  var REF_BASE_BYTES = 102, REF_TOKEN_BYTES = 148;      // nearlaunch.js, from get_user_storage_state
  var BYTE = BigInt('10000000000000000000');            // 1e19 yocto per byte of NEAR storage
  var FT_REG_EST = '1250000000000000000000';            // 0.00125 NEAR; only prices the row, read live before signing
  var GAS_MARGIN = '100000000000000000000000';          // 0.1 NEAR kept free for gas across the approvals
  var SLIP_BPS = 10;                                    // min_amounts at 99.9%, as nearmint.js
  var TGAS = '000000000000';
  // THE NETWORK FEE IS GAS, MEASURED (RAZA 2026-10-31: blank until both assets were picked, and what it then showed
  // was the storage DEPOSITS, not a fee). The full sequence on mainnet -- nspear.near's pool 8978, 2026-10-21:
  // register_tokens+storage_deposit 0.000577, token storage_deposit 0.000235, add_simple_pool 0.000340, wNEAR
  // storage_deposit 0.000232, near_deposit 0.000192, two ft_transfer_call 0.000734 + 0.000733, wNEAR
  // storage_deposit 0.000225, add_liquidity 0.000470 -- burnt 0.00434 NEAR (NearBlocks transaction_fee). An
  // account already registered skips some of it, so this is the most a creation costs, rounded, like Stellar's
  // fixed "≈ 0.00001 XLM". Shown from the moment the dialog opens.
  var NET_FEE = '≈ 0.0043 NEAR';
  var LABEL = 'Create pool';                            // lumoscore.com's own label (_ammdata.js), not the design's

  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return [].slice.call((r || document).querySelectorAll(s)); }
  function modal() { return document.getElementById('createPoolModal'); }
  function C() { return window.lxnCore; }
  function big(v) { return BigInt(String(v == null ? '0' : v)); }
  function maxBig(a, b) { return big(a) > big(b) ? String(a) : String(b); }
  function fc(method, args, tgas, deposit) {
    return { type: 'FunctionCall', params: { methodName: method, args: args, gas: String(tgas) + TGAS, deposit: String(deposit) } };
  }
  function less(raw, bps) { return (big(raw) * BigInt(10000 - bps) / BigInt(10000)).toString(); }

  function addr() {
    try {
      return (window.lxn && window.lxn.address && window.lxn.address())
        || localStorage.getItem('lumos.address') || '';
    } catch (e) { return ''; }
  }

  // ---- text ------------------------------------------------------------------------------------------
  //
  // TRUNCATE AS A STRING, never toFixed. toFixed ROUNDS, and a balance rounded UP is a MAX that cannot be
  // spent -- the trap this project has already paid for once, and the reason browser/qorders.js carries the
  // same pair of helpers. Every figure offered as spendable goes through these.
  function trunc(s, dp) {
    s = String(s);
    var i = s.indexOf('.');
    if (i < 0 || dp == null) return s;
    return dp <= 0 ? s.slice(0, i) : s.slice(0, i + 1 + dp).replace(/\.$/, '');
  }
  // raw integer -> human string, exactly, without ever becoming a float.
  function fromUnits(raw, dec) {
    var s = String(raw || '0').replace(/[^0-9]/g, '') || '0';
    dec = dec == null ? 24 : dec;
    if (!dec) return s;
    while (s.length <= dec) s = '0' + s;
    var out = (s.slice(0, s.length - dec) + '.' + s.slice(s.length - dec)).replace(/0+$/, '').replace(/\.$/, '');
    return out || '0';
  }
  // human string -> raw integer, exactly. Extra decimals are TRUNCATED, never rounded up.
  function toUnits(human, dec) {
    var s = String(human == null ? '' : human).trim().replace(/,/g, '');
    if (!/^\d*\.?\d*$/.test(s) || s === '' || s === '.') return null;
    dec = dec == null ? 24 : dec;
    var p = s.split('.'), i = p[0] || '0', f = (p[1] || '').slice(0, dec);
    while (f.length < dec) f += '0';
    var out = (i + f).replace(/^0+/, '');
    return out === '' ? '0' : out;
  }
  function show(raw, dec, dp) { return trunc(fromUnits(raw, dec), dp == null ? 6 : dp); }
  function num(v) {
    var s = String(v == null ? '' : v).replace(/,/g, '').trim();
    var m = /^\d*\.?\d*/.exec(s);
    var t = m ? m[0] : '';
    return (t === '' || t === '.') ? NaN : Number(t);
  }
  function fmtNear(y) {
    var h = fromUnits(y, 24), n = Number(h);
    if (!isFinite(n) || n <= 0) return '0 NEAR';
    return trunc(h, n < 0.01 ? 6 : 4) + ' NEAR';
  }

  // ---- state -----------------------------------------------------------------------------------------
  //
  // THREE STATES FOR A BALANCE, AND THEY MUST NOT COLLAPSE INTO ONE: undefined = never asked, null = asked
  // and the read failed, a list = what we actually have (including an empty one). Collapsing the first two
  // produced two separate bugs in browser/qorders.js on 2026-10-28 -- a genuine zero shown as an em dash,
  // and "still loading" reported as "could not be read" -- so the same model is used here. Nothing is
  // signed, and the button never goes live, while holdings are undefined or null.
  var H = { hold: undefined, who: '', pick: [null, null], busy: false, loading: null, openIdx: 0, fee: undefined };

  function same(a, b) { return !!a && !!b && a.id === b.id; }
  function isNear(a) { return !!a && a.id === 'near'; }
  function poolId(a) { return isNear(a) ? WNEAR : a.id; }       // native NEAR enters a pool as wrap.near

  // THE SPENDABLE ROOM FOR ONE SIDE, as a raw integer, and the ONLY place it is worked out. MAX offers it,
  // the gate allows it, and the gate's refusal quotes it -- so the three cannot disagree. They did: MAX
  // offered 12.34 of 12.5 NEAR (keeping the gas margin AND the deposits) while the refusal quoted 12.4
  // (keeping only the gas), so typing the number the refusal named was refused again by a different
  // sentence. Same family as a MAX that rounds a balance up past itself.
  //
  // Only native NEAR has anything withheld: an FT balance is all spendable, and when the user picks wNEAR
  // directly it is an FT like any other -- the NEAR for gas and deposits is a separate balance.
  function keepRaw() { return big(GAS_MARGIN) + big((H.fee && H.fee.total) || '0'); }
  function roomRaw(p) {
    var r = big(p.bal);
    if (!isNear(p)) return r;
    var keep = keepRaw();
    return r > keep ? r - keep : BigInt(0);
  }

  function load(force) {
    var who = addr();
    if (!who) { H.hold = []; H.who = ''; return Promise.resolve(); }
    if (!force && H.who === who && H.hold !== undefined && H.hold !== null) return Promise.resolve();
    if (H.loading && !force) return H.loading;
    // readHoldings resolves { near, held, pools }. Prices on `held` are priceNear -- the token's worth in
    // NEAR, not dollars -- which is exactly the common unit the ratio below needs, and makes native NEAR
    // 1 by definition. Reading it as a USD field would have scaled every autofilled amount wrongly.
    H.loading = C().readHoldings(who).then(function (r) {
      var list = [];
      var n = r && r.near;
      if (n) {
        list.push({
          id: 'near', code: 'NEAR', dec: 24, logo: C().NEAR_LOGO, sub: 'NEAR Protocol',
          // n.raw is the whole balance; the account's own storage stake, the gas margin and the deposits
          // come off at MAX and again in blocker(), so the figure on the row stays the honest balance.
          raw: n.raw, bal: n.raw, p: 1
        });
      }
      ((r && r.held) || []).forEach(function (t) {
        // A token whose decimals never arrived cannot be scaled, and a pool deposit at a guessed scale is
        // an unrecoverable mistake. It is left out rather than listed at a scale that may be wrong.
        if (!t || t.dec == null || !(big(t.raw) > BigInt(0))) return;
        list.push({
          id: t.id, code: t.display || t.symbol || '?', dec: +t.dec, logo: t.logo || '',
          sub: t.id, raw: t.raw, bal: t.raw, p: t.priceNear
        });
      });
      H.hold = list;
      H.who = who;
      H.loading = null;
    }, function () {
      H.loading = null;
      if (H.hold === undefined) H.hold = null;                  // asked, failed -- NOT an empty wallet
    });
    return H.loading;
  }

  function holdWhy() {
    if (!addr()) return 'Connect a NEAR wallet to choose assets';
    if (H.hold === undefined) return 'Reading your wallet…';
    if (H.hold === null) return 'Could not read your wallet';
    return '';
  }

  // ---- the design's two asset fields ------------------------------------------------------------------
  function fields() { var m = modal(); return m ? $$('.asset-field', m) : []; }
  function balEl(f) { return $('.field-foot .balance strong', f) || $('.field-foot > span:first-child', f); }

  function paintField(i) {
    var f = fields()[i];
    if (!f) return;
    var a = H.pick[i];
    var pk = $('.asset-picker', f);
    if (pk) {
      // The held version dimmed these and set a not-allowed cursor. Both go.
      pk.removeAttribute('aria-disabled');
      pk.style.pointerEvents = '';
      pk.style.opacity = '';
      pk.style.cursor = '';
      var ico = $('.ap-ico', pk), nm = $('.ap-name', pk);
      if (a) {
        pk.classList.remove('placeholder');
        if (ico) {
          ico.textContent = '';
          ico.setAttribute('data-logoed', '1');              // keep the logo healer off a real logo
          ico.style.background = a.logo ? 'center / cover no-repeat url("' + a.logo + '")' : '';
        }
        if (nm) { nm.textContent = a.code; nm.setAttribute('data-logoed', '1'); nm.style.color = ''; }
      } else {
        pk.classList.add('placeholder');
        if (ico) { ico.removeAttribute('style'); ico.textContent = '?'; ico.setAttribute('data-logoed', '1'); }
        // INHERITED, as on lumoscore.com: the label takes .asset-picker.placeholder's var(--text-muted).
        // Setting a colour here is what made the XRPL fork read a step dimmer than Stellar in dark mode.
        if (nm) { nm.textContent = 'Select asset'; nm.style.color = ''; }
      }
    }
    var b = balEl(f);
    if (b) {
      // NO TICKER AFTER THE FIGURE: the code is already on the picker directly above this line, and
      // lumoscore.com reads "Balance: 51,572" and stops there (RAZA 2026-10-02, on the XRPL fork).
      var txt = a ? show(a.bal, a.dec, 6) : '—';
      if (b.tagName === 'STRONG') b.textContent = txt;
      else b.textContent = 'Balance: ' + txt;
    }
  }

  function closeLists(except) {
    fields().forEach(function (f) {
      var dd = $('.asset-dropdown', f);
      if (dd && dd !== except) { dd.classList.remove('open'); dd.style.display = ''; }
    });
  }

  function renderList(i, ddIn) {
    var f = fields()[i];
    var dd = ddIn || (f && $('.asset-dropdown', f)), list = dd && $('.ad-list', dd);
    if (!list) return;
    var q = (($('.ad-search-input', dd) || {}).value || '').trim().toLowerCase();
    $$('.lx-cpitem', list).forEach(function (n) { n.parentNode.removeChild(n); });

    function note(text) {
      var none = document.createElement('div');
      none.className = 'ad-item lx-cpitem';
      none.style.cssText = 'cursor:default;opacity:.7;justify-content:center';
      none.textContent = text;
      list.appendChild(none);
    }
    // undefined/null are SAID, not drawn as an empty wallet.
    var why = holdWhy();
    if (why) { note(why); return; }

    var rows = (H.hold || []).filter(function (a) {
      if (!q) return true;
      return a.code.toLowerCase().indexOf(q) >= 0 || a.id.toLowerCase().indexOf(q) >= 0;
    });
    if (!rows.length) { note(H.hold.length ? 'No matching assets' : 'No assets in this wallet yet'); return; }

    rows.forEach(function (a) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'ad-item lx-cpitem';
      b.__lxnAsset = a;
      var ic = document.createElement('span');
      ic.className = 'ad-ico';
      ic.setAttribute('data-logoed', '1');
      if (a.logo) ic.style.background = 'center / cover no-repeat url("' + a.logo + '")';
      var meta = document.createElement('span');
      meta.className = 'ad-meta';
      var tk = document.createElement('span'); tk.className = 'ad-tk'; tk.setAttribute('data-logoed', '1'); tk.textContent = a.code;
      var nm = document.createElement('span'); nm.className = 'ad-nm'; nm.textContent = a.sub;
      meta.appendChild(tk); meta.appendChild(nm);
      var bal = document.createElement('span'); bal.className = 'ad-bal'; bal.textContent = show(a.bal, a.dec, 4);
      b.appendChild(ic); b.appendChild(meta); b.appendChild(bal);
      list.appendChild(b);
    });
  }

  function openList(i) {
    H.openIdx = i;
    var f = fields()[i];
    var dd = f && $('.asset-dropdown', f);
    if (!dd) return;
    var wasOpen = dd.classList.contains('open');
    closeLists(dd);
    if (wasOpen) { dd.classList.remove('open'); return; }
    dd.style.display = '';
    dd.classList.add('open');
    renderList(i);
    load().then(function () { renderList(i); });
    var si = $('.ad-search-input', dd);
    if (si) { try { si.focus(); } catch (e) {} }
  }

  // ---- the other amount, at the market rate ------------------------------------------------------------
  //
  // The ratio of the two deposits SETS the opening price, which is what the dialog's own note warns about:
  // get it wrong and arbitrage takes the difference. So typing one side fills the other at the pair's
  // current USD rate -- the same prices the wallet and the Pools page use, from lxnCore.market, so the
  // pages agree about what a token is worth. A token with no listed price has no fair rate, and then
  // NOTHING is filled rather than something guessed.
  function autofill(i) {
    var a = H.pick[i], b = H.pick[1 - i];
    var f = fields();
    if (i < 0 || !a || !b || !f[i] || !f[1 - i]) return;
    var src = $('.asset-amt', f[i]), dst = $('.asset-amt', f[1 - i]);
    if (!src || !dst) return;
    var v = num(src.value);
    if (!(v > 0)) { if (document.activeElement !== dst) dst.value = ''; recalc(); return; }
    if (!(a.p > 0) || !(b.p > 0)) return;
    if (document.activeElement === dst) return;                 // they are typing there
    var other = v * a.p / b.p;
    if (!isFinite(other) || other <= 0) return;
    // toFixed ROUNDS, so it is taken two places WIDER than the figure shown and then truncated back: a
    // suggestion that rounds up is a suggestion the wallet cannot cover.
    var dp = Math.min(b.dec, 8);
    dst.value = trunc(other.toFixed(dp + 2), dp);
    recalc();
  }

  // ---- summary + status ---------------------------------------------------------------------------------
  function summaryRow(label) {
    var m = modal();
    var rows = m ? $$('.pool-summary .row', m) : [];
    for (var i = 0; i < rows.length; i++) {
      var k = rows[i].querySelector('span');
      if (k && new RegExp('^\\s*' + label, 'i').test(k.textContent || '')) return rows[i];
    }
    return null;
  }

  function say(text, tone) {
    var m = modal();
    if (!m) return;
    var box = $('.lxn-cp-say', m);
    if (!box) {
      var sum = $('.pool-summary', m);
      if (!sum) return;
      box = document.createElement('div');
      box.className = 'lxn-cp-say';
      box.style.cssText = 'margin:10px 2px 0;font-size:13px;font-weight:600;line-height:1.5';
      sum.parentNode.insertBefore(box, sum.nextSibling);
    }
    box.textContent = text || '';
    box.style.color = tone === 'bad' ? 'var(--red,#e5484d)' : (tone === 'good' ? 'var(--green,#22c55e)' : 'var(--text-muted,#9aa)');
    box.style.display = text ? '' : 'none';
    box.setAttribute('data-lxauto', '');          // a hand-written message; recalc must not speak over it
  }

  // SAY WHY THE BUTTON IS DEAD. Without this the dialog disables its own button and explains nothing, which
  // is indistinguishable from the broken state RAZA reported in the first place: measured 2026-10-28 by
  // typing more NEAR than the wallet holds — the button dimmed, the status line stayed empty, and clicking
  // it did nothing, because a disabled button never reaches the handler that would have said so.
  //
  // It only ever overwrites its OWN message, never one create() left behind, so a result does not get wiped
  // by the next repaint.
  var QUIET = {
    'Connect a NEAR wallet first.': 1,       // lx-gate owns the button's label in this state
    'Select both assets.': 1,                // the two empty pickers say this already
    'Enter an amount for both assets.': 1    // so do the two empty amount fields
  };
  function sayAuto(text, tone) {
    var m = modal();
    if (!m) return;
    var box = $('.lxn-cp-say', m);
    if (box && box.textContent && box.getAttribute('data-lxauto') !== '1') return;
    if (box && (box.textContent || '') === (text || '')) return;
    say(text, tone);
    box = $('.lxn-cp-say', m);
    if (box && text) box.setAttribute('data-lxauto', '1');
  }

  function amounts() {
    return fields().map(function (f) { var i = $('.asset-amt', f); return num(i && i.value); });
  }
  function primary() { var m = modal(); return m ? $('.modal-foot .btn-primary', m) : null; }
  function setLabel(btn, text) {
    var done = false;
    [].forEach.call(btn.childNodes, function (n) {
      if (n.nodeType === 3 && n.nodeValue.trim()) { n.nodeValue = ' ' + text + ' '; done = true; }
    });
    if (!done) btn.appendChild(document.createTextNode(' ' + text + ' '));
  }

  // ---- what creating this pool actually costs (RAZA's point 5) -------------------------------------------
  //
  // On NEAR the deposits attached to these calls ARE the cost at the moment of signing: Rhea refunds what
  // the storage did not need (0.05 attached, ~0.0049 kept, measured on pool 8978), but what leaves the
  // wallet is the attached total. That is the figure the launchpad's own cost panel states as "liq. pool &
  // network" (nearlaunch.js costPlan: refAcct + pool + liq + the token registrations), so this dialog
  // states the same thing the same way rather than inventing a second meaning for the word.
  //
  // It is READ FROM THE CHAIN, not assumed: registration is per token and per account, so the figure for a
  // pair whose tokens Rhea already knows is genuinely smaller. While the read is in flight the row keeps
  // its em dash; a read that FAILS leaves it an em dash too and the button will not go live -- a cost
  // quoted from a failed lookup is the one thing worse than no cost.
  function feeKey() {
    var a = H.pick[0], b = H.pick[1];
    return a && b ? addr() + '|' + poolId(a) + '|' + poolId(b) : '';
  }
  function readFee() {
    var a = H.pick[0], b = H.pick[1], me = addr();
    var key = feeKey();
    if (!key || !me) { H.fee = undefined; return Promise.resolve(); }
    if (H.fee && H.fee.key === key) return Promise.resolve();
    H.fee = { key: key, total: undefined };
    var ids = [poolId(a), poolId(b)].filter(function (v, i, s) { return s.indexOf(v) === i; });
    var needWrap = isNear(a) || isNear(b);
    return Promise.all([
      // Rhea's view of me: how much storage I have paid for, and how much is already used.
      C().callView(REF, 'get_user_storage_state', { account_id: me }).catch(function () { return null; }),
      Promise.all(ids.map(function (t) {
        return Promise.all([
          C().callView(t, 'storage_balance_of', { account_id: REF }).catch(function () { return undefined; }),
          C().callView(t, 'storage_balance_bounds', {}).catch(function () { return undefined; })
        ]);
      })),
      needWrap
        ? C().callView(WNEAR, 'storage_balance_of', { account_id: me }).catch(function () { return undefined; })
        : Promise.resolve(null)
    ]).then(function (r) {
      if (feeKey() !== key) return;                              // the pair changed while this was in flight
      var st = r[0], toks = r[1], wrapBal = r[2];
      // Rhea account: new -> the flat 0.01; existing -> the shortfall for two more token slots, if any.
      var refAcct = '0';
      if (st == null) refAcct = REF_ACCOUNT_NEW;                 // no record at all = not registered
      else {
        var paid = big(st.deposit || 0), used = big(st.usage || 0);
        var want = BigInt(REF_BASE_BYTES + REF_TOKEN_BYTES * ids.length) * BYTE;
        var need = used + want;
        refAcct = paid >= need ? '0' : (need - paid).toString();
      }
      var regs = BigInt(0), unknown = false;
      toks.forEach(function (p) {
        var bal = p[0], bounds = p[1];
        if (bal === undefined || bounds === undefined) { unknown = true; return; }
        if (bal) return;                                         // Rhea is already registered on this token
        regs += big((bounds && bounds.min) || FT_REG_EST);
      });
      var wrapReg = BigInt(0);
      if (needWrap) {
        if (wrapBal === undefined) unknown = true;
        else if (!wrapBal) wrapReg = big(FT_REG_EST);
      }
      if (unknown) { H.fee = { key: key, total: null }; recalc(); return; }
      H.fee = {
        key: key, refAcct: refAcct, regs: regs.toString(), wrapReg: wrapReg.toString(),
        total: (big(refAcct) + regs + wrapReg + big(REF_POOL_DEPOSIT) + big(REF_LIQ_DEPOSIT)).toString()
      };
      recalc();
    });
  }

  function recalc() {
    var m = modal();
    if (!m) return;

    // "MAX" is three letters in a rounded box, which the logo healer repaints as a token mark. Its stamp is
    // removed, its label restored, and an empty svg keeps the healer off it (RAZA 2026-09-16 on the XRPL
    // fork: "Instead on max button, its showin tiny ATOM logo").
    $$('.max-btn', m).forEach(function (b) {
      if (b.getAttribute('data-logo')) { b.removeAttribute('data-logo'); b.style.background = ''; b.style.backgroundImage = ''; }
      b.setAttribute('data-logoed', '1');
      if (!(b.textContent || '').trim()) b.insertBefore(document.createTextNode('MAX'), b.firstChild);
      if (!b.querySelector('svg')) {
        var s0 = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        s0.setAttribute('width', '0'); s0.setAttribute('height', '0');
        s0.style.cssText = 'position:absolute;width:0;height:0';
        b.appendChild(s0);
      }
    });

    // RAZA's point 1: "... on NEAR AMM", Stellar's shape. The design ships Stellar's or Aptos's name.
    $$('.modal-sub', m).forEach(function (s) {
      if (/Stellar|Aptos/i.test(s.textContent || '')) s.textContent = 'Initialize a new liquidity pool on NEAR AMM';
    });

    // RAZA's point 4: remove the Trading fee row. REMOVED rather than hidden -- a hidden row leaves the
    // wrong bytes (the design's "0.5%", which is not this pool's 0.3%) in the page for anything that reads
    // them, and this build has been bitten by exactly that before.
    var fee = summaryRow('Trading fee');
    if (fee && fee.parentNode) fee.parentNode.removeChild(fee);

    // RAZA's point 5: the network fee, as a figure. The design ships "~0.00001 APT" -- Aptos's number,
    // re-skinned. An em dash until the chain has answered; never a guess.
    var net = summaryRow('Network fee');
    if (net) {
      var nv = net.querySelector('strong');
      if (nv) {
        if (nv.textContent !== NET_FEE) nv.textContent = NET_FEE;
      }
      net.title = 'Gas burnt by the whole sequence, measured on mainnet. Storage deposits are separate, and what the storage did not need is refunded.';
    }

    var px = summaryRow('Initial pool price');
    if (px) {
      var pv = px.querySelector('strong');
      var am = amounts(), a = H.pick[0], b = H.pick[1];
      // STELLAR'S SHAPE AND STELLAR'S PRECISION: a rate, "0.002081 HOLA/CANNACOIN", at two decimals --
      // except where two decimals would destroy the number, and then enough places to stay a number
      // (RAZA 2026-10-02, on the XRPL fork).
      if (pv) {
        if (!(a && b && am[0] > 0 && am[1] > 0)) pv.textContent = '—';
        else {
          var rate = am[1] / am[0];
          pv.textContent = (rate < 0.01 ? trunc(rate.toFixed(8), 6) : rate.toFixed(2)) + ' ' + b.code + '/' + a.code;
        }
      }
    }

    // RAZA's point 2: the button says what it does, and is live when it can do it.
    var go = primary();
    if (go && !H.busy) {
      if (!go.__lxnLabelled) { go.__lxnLabelled = 1; setLabel(go, LABEL); }
      var why = blocker();
      var ok = !why;
      // A message ending in an ellipsis is progress, not a refusal, so it is not painted red.
      if (!why || QUIET[why]) sayAuto('');
      else sayAuto(why, why.slice(-1) === '…' ? '' : 'bad');
      // DIMMED, NOT DISABLED (RAZA 2026-10-31: pressing Create pool with one asset said nothing, where Stellar
      // answers "Select both assets." under the button). A disabled button never fires a click, so create() -- which
      // already states the blocker in red -- was never reached. The look stays Stellar's dimmed one (data-lxdis).
      go.disabled = false;
      if (ok) {
        go.removeAttribute('aria-disabled');
        go.removeAttribute('data-lxdis');
        go.style.opacity = '';
        go.style.cursor = '';
        go.style.pointerEvents = '';
      } else {
        go.setAttribute('aria-disabled', 'true');
        // The inherited stylesheet styles a disabled primary through this attribute, so setting it is what
        // makes the dimming match Stellar's instead of inventing a second disabled look.
        go.setAttribute('data-lxdis', '1');
        go.style.opacity = '.55';
        go.style.cursor = 'not-allowed';
        go.style.pointerEvents = 'auto';
      }
    }
  }

  // What stops this pool being created right now, as a sentence -- or '' when nothing does. One function,
  // so the button's live/dead state and the message the reader gets can never disagree.
  function blocker() {
    if (!addr()) return 'Connect a NEAR wallet first.';
    if (H.hold === undefined) return 'Reading your wallet…';
    if (H.hold === null) return 'Could not read your wallet.';
    var a = H.pick[0], b = H.pick[1];
    if (!a || !b) return 'Select both assets.';
    if (same(a, b) || poolId(a) === poolId(b)) return 'Pick two different assets.';
    var am = amounts();
    if (!(am[0] > 0) || !(am[1] > 0)) return 'Enter an amount for both assets.';
    for (var i = 0; i < 2; i++) {
      var p = H.pick[i], raw = toUnits(String(am[i]), p.dec);
      if (raw == null || !(big(raw) > BigInt(0))) return 'That amount is too small for ' + p.code + '.';
      // The cost has to be known before any NEAR figure can be quoted, because the room withheld from the
      // NEAR side includes it.
      if (isNear(p)) {
        if (!H.fee || H.fee.total === undefined) return 'Working out what this costs…';
        if (H.fee.total === null) return 'Could not read what this pool would cost.';
      }
      var room = roomRaw(p);
      if (big(raw) > room) {
        return isNear(p)
          ? ('More than your spendable NEAR (' + show(room.toString(), 24, 6) + ' — '
            + show(GAS_MARGIN, 24, 2) + ' is kept for gas and ' + show(H.fee.total, 24, 6) + ' for deposits).')
          : ('More than your ' + p.code + ' balance (' + show(p.bal, p.dec, 6) + ').');
      }
    }
    if (!H.fee || H.fee.total === undefined) return 'Working out what this costs…';
    if (H.fee.total === null) return 'Could not read what this pool would cost.';
    // When NEITHER side is native NEAR, nothing above has reserved anything, so the NEAR balance still has
    // to cover the deposits and the gas on its own. When one side IS native NEAR, roomRaw already did it,
    // and checking again here would withhold it twice.
    if (!isNear(a) && !isNear(b)) {
      var near = (H.hold || []).filter(isNear)[0];
      var needed = keepRaw();
      if (!near || big(near.bal) < needed) {
        return 'Not enough NEAR: this needs about ' + show(needed.toString(), 24, 4)
          + ' for deposits and gas, and ' + (near ? show(near.bal, 24, 4) : '0') + ' is available.';
      }
    }
    return '';
  }

  // ---- finding an existing pool ------------------------------------------------------------------------
  //
  // Rhea does NOT refuse a duplicate, so this lookup decides whether liquidity joins a live pool or starts a
  // second one beside it. Two sources, because neither alone is complete: the curated list carries every
  // pool with real liquidity (it is the roster the whole NEAR build is drawn from), and a backward scan of
  // the newest 300 catches a pool created too recently to be in it -- the same scan nearmint.js uses.
  // A lookup that FAILS returns undefined, not null: "could not ask" is not "there is none".
  // THE CURATED, LIQUIDITY-RANKED LIST IS THE ONLY SOURCE THAT MAY CHOOSE A POOL. It answers with an id, or
  // null for "this pair has no pool", or undefined for "could not ask" -- and undefined is never read as
  // null, because creating a pool beside a live one splits it.
  //
  // IT MUST NOT BE THE NEWEST MATCH. A backward scan of Rhea's newest pools was tried here first and is
  // dangerous: on 2026-10-28 the newest wrap.near/usdt.tether-token.near pool on mainnet was 8981, holding
  // ~103 wNEAR against 71854 raw USDt -- seven cents -- at total_fee 9990, a 99.9% fee. The real pair is
  // 3879 (fee 30, the normal rate, with real reserves). Depositing into 8981 would have handed the deposit
  // to whoever set that trap. So the scan below is used for ONE thing only: recovering the id of a pool
  // THIS dialog just created, when the wallet returned no outcome to read it from. That is also the only
  // thing nearmint.js uses it for.
  function findPool(ta, tb) {
    return fetch('/lxapi/nearpools?n=300').then(function (r) { return r.json(); }).then(function (d) {
      if (!d || !d.ok || !d.rows) throw new Error('pool list unavailable');
      var hit = d.rows.filter(function (p) {
        var ids = (p.tokens || []).map(function (t) { return t.i; });
        return ids.length === 2 && ids.indexOf(ta) >= 0 && ids.indexOf(tb) >= 0;
      }).sort(function (x, y) { return (y.liq || 0) - (x.liq || 0); })[0];
      return hit ? Number(hit.id) : null;
    }, function () { return undefined; });
  }

  // A POOL JUST CREATED IS NOT READABLE AT ONCE (RAZA 2026-11-04, LUMOS/wNEAR pool 8998: "E85: invalid pool id"
  // and no liquidity step). add_simple_pool's receipt returns the id a block or two before the RPC's finalised
  // view holds the pool, and get_pool on it panics with E85. So E85 is asked again, for about 15 seconds, before
  // it counts as an answer; any other error is passed on at once.
  function poolSettled(pid, tries) {
    tries = tries == null ? 10 : tries;
    return C().callView(REF, 'get_pool', { pool_id: pid }).catch(function (e) {
      if (tries > 0 && /E85|invalid pool id/i.test(String((e && e.message) || e))) {
        return new Promise(function (r) { setTimeout(r, 1500); }).then(function () { return poolSettled(pid, tries - 1); });
      }
      throw e;
    });
  }

  // The pool this dialog has just created: the NEWEST match is the right answer here, because it is ours.
  function findOurPool(ta, tb) {
    return C().callView(REF, 'get_number_of_pools', {}).then(function (n) {
      n = Number(n) || 0;
      if (n <= 0) return null;
      var from = Math.max(0, n - 300);
      return C().callView(REF, 'get_pools', { from_index: from, limit: n - from }).then(function (ps) {
        for (var i = (ps || []).length - 1; i >= 0; i--) {
          var p = ps[i], t = (p && p.token_account_ids) || [];
          if (p.pool_kind === 'SIMPLE_POOL' && t.length === 2 && t.indexOf(ta) >= 0 && t.indexOf(tb) >= 0
            && Number(p.total_fee) === POOL_FEE_BPS) return from + i;
        }
        return null;
      });
    });
  }

  // ---- signing (a person approves every transaction in their own wallet) --------------------------------
  //
  // Its own copy, as browser/neardcl.js keeps its own: window.lxnSwap is on the dashboard pages only, and
  // this dialog is on eight.
  function sign(txs) {
    if (!window.lxn || typeof window.lxn.wallet !== 'function') return Promise.reject(new Error('Connect a NEAR wallet first.'));
    return window.lxn.wallet().then(function (w) {
      if (!w) throw new Error('No NEAR wallet is connected.');
      if (txs.length === 1) {
        if (typeof w.signAndSendTransaction !== 'function') throw new Error('This wallet cannot sign transactions here.');
        return w.signAndSendTransaction(txs[0]).then(function (r) { return [r]; });
      }
      if (typeof w.signAndSendTransactions !== 'function') throw new Error('This wallet cannot sign several transactions at once.');
      return w.signAndSendTransactions({
        signerId: txs[0].signerId,
        transactions: txs.map(function (t) { return { receiverId: t.receiverId, actions: t.actions }; })
      });
    });
  }
  // A FunctionCall's return value, base64 in the final execution outcome.
  function decodeValue(r) {
    try {
      var v = r && r.status && r.status.SuccessValue;
      if (!v) return null;
      return JSON.parse(decodeURIComponent(escape(atob(v))));
    } catch (e) { return null; }
  }
  function rejected(e) {
    var s = String((e && (e.message || e)) || '');
    return /reject|denied|cancel|closed|abort/i.test(s);
  }

  // ---- create ------------------------------------------------------------------------------------------
  function create() {
    if (H.busy) return;
    var me = addr();
    if (!me) { if (window.lxn && window.lxn.open) window.lxn.open(); return; }
    var why = blocker();
    if (why) { say(why, 'bad'); return; }

    var a = H.pick[0], b = H.pick[1], am = amounts();
    var ta = poolId(a), tb = poolId(b);
    var rawA = toUnits(String(am[0]), a.dec), rawB = toUnits(String(am[1]), b.dec);

    var go = primary();
    H.busy = true;
    function stop(text, tone) {
      H.busy = false;
      if (go) { setLabel(go, LABEL); go.disabled = false; }
      if (text != null) say(text, tone);
      recalc();
    }
    if (go) { setLabel(go, 'Checking…'); go.disabled = true; }
    say('');

    // Re-read everything that can have moved since the dialog was filled in, and re-apply the same gate.
    Promise.all([load(true), readFee(), findPool(ta, tb)]).then(function (r) {
      var existing = r[2];
      if (existing === undefined) {
        return stop('Could not check whether this pair already has a pool, so nothing was created — '
          + 'creating a second pool would split its liquidity. Try again in a moment.', 'bad');
      }
      var why2 = blocker();
      if (why2) return stop(why2, 'bad');

      // ---- the plan ------------------------------------------------------------------------------------
      var ids = ta === tb ? [ta] : [ta, tb];
      var needWrap = isNear(a) || isNear(b);
      return Promise.all([
        Promise.all(ids.map(function (t) {
          return Promise.all([
            C().callView(t, 'storage_balance_of', { account_id: REF }),
            C().callView(t, 'storage_balance_bounds', {})
          ]);
        })),
        C().callView(REF, 'get_user_storage_state', { account_id: me }).catch(function () { return null; }),
        C().callView(REF, 'get_user_whitelisted_tokens', { account_id: me }).catch(function () { return []; }),
        C().callView(REF, 'get_whitelisted_tokens', {}).catch(function () { return []; }),
        needWrap ? C().callView(WNEAR, 'storage_balance_of', { account_id: me }) : Promise.resolve(null)
      ]).then(function (q) {
        var tokSt = q[0], refSt = q[1], mine = q[2] || [], white = q[3] || [], wrapBal = q[4];

        var txs1 = [];
        ids.forEach(function (t, i) {
          if (!tokSt[i][0]) {
            txs1.push({
              signerId: me, receiverId: t,
              actions: [fc('storage_deposit', { account_id: REF, registration_only: true }, 30,
                maxBig((tokSt[i][1] && tokSt[i][1].min) || FT_REG_EST, '1'))]
            });
          }
        });

        var refActs = [];
        var refAcct = (H.fee && H.fee.refAcct) || '0';
        if (big(refAcct) > BigInt(0)) refActs.push(fc('storage_deposit', { account_id: me, registration_only: false }, 30, refAcct));
        // A token Rhea does not whitelist is refused on deposit (ERR_TOKEN_NOT_WHITELISTED) unless the
        // account whitelists it for itself first. nearmint.js hits this on every freshly minted token.
        var known = {};
        [].concat(mine, white).forEach(function (t) { known[t] = 1; });
        var toReg = ids.filter(function (t) { return !known[t]; });
        if (toReg.length) refActs.push(fc('register_tokens', { token_ids: toReg }, 30, '1'));

        var creating = existing == null;
        if (creating) refActs.push(fc('add_simple_pool', { tokens: ids, fee: POOL_FEE_BPS }, 50, REF_POOL_DEPOSIT));
        if (refActs.length) txs1.push({ signerId: me, receiverId: REF, actions: refActs });

        // ---- step 1 ------------------------------------------------------------------------------------
        if (go) setLabel(go, txs1.length ? 'Confirm in wallet…' : 'Preparing…');
        var step1 = txs1.length ? sign(txs1) : Promise.resolve([]);

        return step1.then(function (outs) {
          var pid = existing;
          if (creating) {
            // The pool id is add_simple_pool's return value. If the wallet gave no outcome to read it from
            // (several do not), the chain is asked instead -- never assumed.
            for (var i = (outs || []).length - 1; i >= 0 && pid == null; i--) {
              var v = decodeValue(outs[i]);
              if (typeof v === 'number') pid = v;
            }
            if (pid == null) {
              if (go) setLabel(go, 'Finding the pool…');
              return findOurPool(ta, tb).then(function (found) {
                if (found == null) {
                  throw new Error('The pool was created but could not be found to add liquidity. '
                    + 'Open Pools and add liquidity to it there.');
                }
                return found;
              });
            }
          }
          return pid;
        }).then(function (pid) {
          if (pid == null) throw new Error('No pool to add liquidity to.');
          // The pool decides the ORDER of the amounts; assuming [a, b] would deposit each amount against
          // the wrong token in a pool created by somebody else.
          return poolSettled(Number(pid)).then(function (p) {
            var order = (p && p.token_account_ids) || [];
            if (order.length !== 2 || order.indexOf(ta) < 0 || order.indexOf(tb) < 0) {
              throw new Error('That pool holds a different pair than the one chosen.');
            }
            // A POOL THIS DIALOG DID NOT CREATE GETS ITS FEE CHECKED. Anyone can create a Rhea pool at any
            // fee, and mainnet has pairs whose newest pool charges 99.9% (see findPool). A normal pool is
            // 30 bps; a deposit into anything far above that is a deposit into somebody's trap, so it is
            // refused with the figure rather than signed.
            var poolFee = Number(p.total_fee);
            if (!isFinite(poolFee) || poolFee > 100) {
              throw new Error('That pair’s pool charges a ' + (isFinite(poolFee) ? (poolFee / 100) + '%' : 'unreadable')
                + ' trading fee, so nothing was deposited. A normal pool charges '
                + (POOL_FEE_BPS / 100) + '%. Add liquidity from the pool’s own page if you meant to.');
            }
            var byId = {}; byId[ta] = rawA; byId[tb] = rawB;
            var amountsIn = order.map(function (t) { return byId[t]; });

            // ---- step 2 ------------------------------------------------------------------------------
            var txs2 = [];
            // The wNEAR side: register me if needed, wrap the NEAR, then deposit it into Rhea.
            if (needWrap) {
              var wActs = [];
              if (!wrapBal) wActs.push(fc('storage_deposit', { account_id: me, registration_only: true }, 10, FT_REG_EST));
              var nearRaw = isNear(a) ? rawA : rawB;
              wActs.push(fc('near_deposit', {}, 10, nearRaw));
              // 100 TGas, not a smaller round number: ft_transfer_call is a cross-contract chain (token ->
              // Rhea's ft_on_transfer -> the callback) and this is the figure nearmint.js has deposited
              // with on mainnet. Under-funding it strands a transfer that still costs the gas it burnt.
              wActs.push(fc('ft_transfer_call', { receiver_id: REF, amount: nearRaw, msg: '' }, 100, '1'));
              txs2.push({ signerId: me, receiverId: WNEAR, actions: wActs });
            }
            // The other side (or both, when neither is native NEAR).
            [[a, ta, rawA], [b, tb, rawB]].forEach(function (s) {
              if (isNear(s[0])) return;                          // handled by the wrap.near transaction
              txs2.push({
                signerId: me, receiverId: s[1],
                actions: [fc('ft_transfer_call', { receiver_id: REF, amount: s[2], msg: '' }, 100, '1')]
              });
            });
            txs2.push({
              signerId: me, receiverId: REF,
              actions: [fc('add_liquidity', {
                pool_id: Number(pid),
                amounts: amountsIn,
                min_amounts: amountsIn.map(function (x) { return less(x, SLIP_BPS); })
              }, 50, REF_LIQ_DEPOSIT)]
            });

            if (go) setLabel(go, 'Confirm in wallet…');
            say(creating ? 'Pool created. One more approval adds the liquidity.'
              : 'This pair already has a pool, so your liquidity goes into it.');
            return sign(txs2).then(function () {
              stop('Liquidity added ✓ Opening the pool…', 'good');
              setTimeout(function () {
                window.location.href = '/pools/near/id/' + encodeURIComponent(pid);
              }, 1200);
            }, function (e) {
              // The pool exists from here on, whatever happened to the liquidity, so the reader is told
              // where it is rather than left to wonder whether the first approval did anything.
              if (rejected(e)) {
                return stop(creating
                  ? ('The pool was created (#' + pid + ') but no liquidity was added. Open it from Pools to add some.')
                  : 'Nothing was signed, so nothing moved.', 'bad');
              }
              return stop((creating ? 'The pool was created (#' + pid + ') but the liquidity step failed: ' : 'The liquidity step failed: ')
                + ((e && e.message) || 'the wallet reported an error.'), 'bad');
            });
          });
        }, function (e) {
          return stop(rejected(e) ? 'Nothing was signed, so nothing moved.'
            : ((e && e.message) || 'The pool could not be created.'), 'bad');
        });
      });
    }).catch(function (e) {
      stop((e && e.message) || 'Something went wrong, and nothing was signed.', 'bad');
    });
  }

  // ---- wiring --------------------------------------------------------------------------------------------
  function fieldIndex(node) {
    var f = node.closest && node.closest('.asset-field');
    return f ? fields().indexOf(f) : -1;
  }
  function closeModal() {
    var m = modal();
    if (!m) return;
    m.classList.remove('open');
    if (m.style.display === 'flex') m.style.display = '';
    try { document.body.style.overflow = ''; } catch (e) {}
    closeLists();
  }

  function wire() {
    if (window.__lxnCpWired) return;
    window.__lxnCpWired = 1;

    // WINDOW CAPTURE, and it is load-bearing: without lx-ammdata the design's own nav shim answers a click
    // on a picker with lxNavigate(["lumoscore-amm-pool-light.html", ...]) and LEAVES THE PAGE. Another of
    // its handlers reads mock data-asset-bal attributes off .ad-item -- Stellar's KALE/yXLM/AQUA. Both are
    // stopped here, before they run.
    window.addEventListener('click', function (e) {
      var m = modal();
      var t = e.target;
      if (!m || !t || !t.closest || !m.contains(t)) {
        if (m && m.classList.contains('open')) closeLists();
        return;
      }
      var item = t.closest('.lx-cpitem');
      if (item && item.__lxnAsset) {
        e.preventDefault(); e.stopImmediatePropagation();
        var i = fieldIndex(item);
        if (i < 0) return;
        H.pick[i] = item.__lxnAsset;
        // A new asset makes the old amount meaningless: this side is cleared and filled again from the
        // other side at the new pair's rate.
        var ampI = $('.asset-amt', fields()[i]);
        if (ampI) ampI.value = '';
        if (H.pick[1 - i] && poolId(H.pick[1 - i]) === poolId(H.pick[i])) H.pick[1 - i] = null;
        closeLists();
        paintField(0); paintField(1); say('');
        H.fee = undefined;
        recalc();
        readFee();
        var am0 = amounts();
        if (am0[i] > 0) autofill(i); else if (am0[1 - i] > 0) autofill(1 - i);
        return;
      }
      if (t.closest('.lx-cpitem') || t.closest('.ad-search')) { e.stopImmediatePropagation(); return; }
      var pk = t.closest('.asset-picker');
      if (pk) {
        e.preventDefault(); e.stopImmediatePropagation();
        if (!addr()) { if (window.lxn && window.lxn.open) window.lxn.open(); return; }
        openList(fieldIndex(pk));
        return;
      }
      var mx = t.closest('.max-btn');
      if (mx) {
        e.preventDefault(); e.stopImmediatePropagation();
        var j = fieldIndex(mx), pa = H.pick[j];
        var w = holdWhy();
        if (w) { say(w + '.', 'bad'); return; }
        // MAX on an empty side opens that side's list: there is nothing to fill until an asset is chosen.
        if (!pa) { say('Choose an asset first.', 'bad'); openList(j); return; }
        // roomRaw keeps the gas margin AND the deposits back on the NEAR side -- a MAX that spends the gas
        // is a MAX that cannot be signed. Same function the gate and its refusal use.
        var room = roomRaw(pa);
        var ob = H.pick[1 - j];
        // A ZERO ROOM SAYS SO. It wrote "0" into the field and nothing else, which RAZA read as "MAX is not
        // working" (2026-10-31, 0.08 NEAR against a 0.1 NEAR gas margin plus the deposits).
        var noRoom = function (p) {
          return isNear(p)
            ? 'Nothing to add: you hold ' + show(p.bal, 24, 6) + ' NEAR and ' + show(keepRaw().toString(), 24, 4)
              + ' NEAR has to stay free for gas and the pool deposits.'
            : 'You hold no ' + p.code + ' to add.';
        };
        if (!(room > BigInt(0))) { say(noRoom(pa), 'bad'); return; }
        if (ob && !(roomRaw(ob) > BigInt(0))) { say(noRoom(ob), 'bad'); return; }
        // MAX IS WHAT THE OTHER SIDE CAN MATCH: a pool takes both deposits at one ratio, so offering more
        // of this asset than the other side can pair with offers an amount that cannot be deposited
        // (RAZA 2026-09-16 on the XRPL fork: "I only got 1 XRP worth of … ATOM … so when i select MAX for
        // asset 1, i should only have been able to select 1 XRP worth").
        var human = fromUnits(room.toString(), pa.dec);
        if (ob && pa.p > 0 && ob.p > 0) {
          var cap = Number(fromUnits(roomRaw(ob).toString(), ob.dec)) * ob.p / pa.p;
          var cdp = Math.min(pa.dec, 8);
          if (isFinite(cap) && cap >= 0 && cap < Number(human)) human = trunc(cap.toFixed(cdp + 2), cdp);
        }
        var inp = $('.asset-amt', fields()[j]);
        if (inp) inp.value = trunc(human, Math.min(pa.dec, 8));
        recalc();
        autofill(j);
        return;
      }
      if (t.closest('.modal-foot .btn-primary')) {
        e.preventDefault(); e.stopImmediatePropagation();
        create();
        return;
      }
      if (t === m || t.closest('[data-close]')) { closeModal(); return; }
      if (!t.closest('.asset-dropdown')) closeLists();
    }, true);

    window.addEventListener('input', function (e) {
      var m = modal(), t = e.target;
      if (!m || !t || !m.contains(t)) return;
      if (t.classList && t.classList.contains('asset-amt')) {
        var clean = String(t.value).replace(/[^0-9.]/g, '');
        var dot = clean.indexOf('.');
        if (dot >= 0) clean = clean.slice(0, dot + 1) + clean.slice(dot + 1).replace(/\./g, '');
        if (clean !== t.value) t.value = clean;
        recalc();
        say('');
        autofill(fieldIndex(t));
      } else if (t.classList && t.classList.contains('ad-search-input')) {
        // The design's own filter runs after this and hides every row it does not recognise -- it only
        // knows its mock Stellar assets. This owns the box.
        e.stopImmediatePropagation();
        var fi = fieldIndex(t);
        renderList(fi >= 0 ? fi : H.openIdx, t.closest && t.closest('.asset-dropdown'));
      }
    }, true);

    document.addEventListener('keydown', function (e) {
      var m = modal();
      if (e.key === 'Escape' && m && m.classList.contains('open')) closeModal();
    });

    // The dialog opens from the Pools page's button, the dashboard card, the $LUMOS page or the design's
    // own script -- so its OPENING is watched, not any one opener.
    var m = modal();
    if (m && window.MutationObserver) {
      new MutationObserver(function () {
        if (m.classList.contains('open') || m.style.display === 'flex') {
          recalc();
          load().then(function () {
            // A wallet switch empties choices that belonged to the previous account.
            H.pick = H.pick.map(function (p) {
              return (p && (H.hold || []).filter(function (h) { return same(h, p); })[0]) || null;
            });
            // NO DEFAULT ASSET ON THE $LUMOS PAGE, where the XRPL fork preselects LUMOS as Asset 1
            // (RAZA 2026-09-17). There is no LUMOS on NEAR to select: the factory account does not exist
            // yet, and nearlaunch.js says so on its own line. When it is minted, this is where it goes.
            paintField(0); paintField(1);
            recalc();
            readFee();
          });
        }
      }).observe(m, { attributes: true, attributeFilter: ['class', 'style'] });
    }
  }

  function boot() {
    var m = modal();
    if (!m || !window.lxnCore) return;
    paintField(0); paintField(1);
    recalc();
    wire();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
