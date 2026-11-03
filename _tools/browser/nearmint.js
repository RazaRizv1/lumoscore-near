// NEAR Launchpad, the launch itself: the review page's "Confirm & Launch", as four wallet approvals (the
// fourth locks the liquidity, RAZA 2026-11-03; see buildLockTxs).
// Ported from the XRPL fork's browser/mint.js (plan built in full before anything is signed, every
// dependency injectable so the sequence can be captured and tested, partial completion reported in full
// and resumable). Helpers come from browser/nearlaunch.js through window.__lxnLaunch.
//
// THE SEQUENCE. The pool id is only known once add_simple_pool has run, and nothing about it can be
// predicted safely (get_number_of_pools races every other pool creator on Rhea), so three approvals is
// the minimum. Folding the factory call into the pool approval was rejected too: if create_token is
// refunded (the name was taken a moment earlier), a pool for a token that does not exist would already
// be paid for.
//
//   1. TOKEN      factory.create_token({args}), 150 TGas, deposit = storage_cost_of(args) +
//                 max(min_fee, $5 in NEAR). Everything above storage goes to the fee account on success;
//                 the WHOLE deposit is refunded on failure.
//   2. POOL       token.storage_deposit({account_id: Rhea, registration_only: true})  deposit = the token's
//                     storage_balance_bounds.min (read live; 0.00125 NEAR for this token contract)
//                 Rhea: [storage_deposit({account_id: me, registration_only: false}) when the account is
//                     new (0.01 NEAR) or short of room for two more tokens (the exact shortfall)],
//                     register_tokens({token_ids: [token]}) 1 yocto -- a new token is not on Rhea's
//                     whitelist and .lumoscore.near is not an auto-whitelisted suffix, so without this
//                     Rhea refuses the deposit (ERR_TOKEN_NOT_WHITELISTED) --
//                     add_simple_pool({tokens: [token, wrap.near], fee: 30}) 0.05 NEAR, excess refunded.
//                 The pool id is the Rhea transaction's return value, checked against get_pool.
//   3. LIQUIDITY  wrap.near: [storage_deposit for me if unregistered], near_deposit (the liquidity NEAR),
//                     ft_transfer_call({receiver_id: Rhea, amount, msg: ""})
//                 token: ft_transfer_call({receiver_id: Rhea, amount: the pool share of supply, msg: ""})
//                 Rhea: add_liquidity({pool_id, amounts: [token, wNEAR], min_amounts: 99.9%}) 0.01 NEAR
// This is exactly the shape of a real mainnet launch on 2026-10-21 (nspear.near: token.nspear.near and
// pool 8978), which used the same deposits; only the grouping into three approvals is ours.
//
// FEE 30 BPS: 0.3%, the fee nearly every recent [token, wrap.near] simple pool on Rhea was created with.
// The pool's LP shares are then LOCKED: step 4 sends every one of them to the all-zeros account (buildLockTxs).
//
// PARTIAL COMPLETION. lumos.launch.result is written the moment the token exists (stage "token"), again
// with the pool id (stage "pool") and at the end (stage "done"), so the confirm page always tells the truth
// and the review page offers "Retry pool step" for a token whose pool did not finish. A retry re-reads the
// chain first: an existing [token, wrap.near] pool is reused, and anything already deposited on Rhea is not
// sent twice.
(function () {
  if (window.__lxnMint) return;
  window.__lxnMint = 1;

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return [].slice.call((r || document).querySelectorAll(s)); };
  function L() { return window.__lxnLaunch; }

  var TGAS = '000000000000';
  var RETRY = 'Retry pool step';
  var LAUNCH = 'Confirm & Launch';
  var GAS_MARGIN = '100000000000000000000000';       // 0.1 NEAR kept free for gas across three approvals

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fc(method, args, tgas, deposit) {
    return { type: 'FunctionCall', params: { methodName: method, args: args, gas: String(tgas) + TGAS, deposit: String(deposit) } };
  }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  // ---- the plan, as data ------------------------------------------------------------------------------------
  function buildCreateTx(p) {
    return { receiverId: L().factory(), actions: [fc('create_token', { args: p.args }, 150, p.createDeposit)] };
  }
  // st: { tokenRegMin, refNeedsTokenReg, refAcct (yocto, '0' = none), pool: existing id or null }
  function buildPoolTxs(token, st) {
    var REF = L().REF, txs = [];
    if (st.refNeedsTokenReg) {
      txs.push({ receiverId: token, actions: [fc('storage_deposit', { account_id: REF, registration_only: true }, 30, st.tokenRegMin)] });
    }
    var acts = [];
    if (L().big(st.refAcct) > BigInt(0)) acts.push(fc('storage_deposit', { account_id: st.me, registration_only: false }, 30, st.refAcct));
    if (!st.registered) acts.push(fc('register_tokens', { token_ids: [token] }, 30, '1'));
    if (st.pool == null) acts.push(fc('add_simple_pool', { tokens: [token, L().WNEAR], fee: L().POOL_FEE_BPS }, 50, L().REF_POOL_DEPOSIT));
    if (acts.length) txs.push({ receiverId: REF, actions: acts });
    return txs;
  }
  function less(a, bps) { return (L().big(a) * BigInt(10000 - bps) / BigInt(10000)).toString(); }
  // st: { me, poolId, needNear, needTok, wrapReg (yocto or '0'), poolRaw, liq }
  function buildLiquidityTxs(token, st) {
    var REF = L().REF, WNEAR = L().WNEAR, big = L().big, txs = [];
    if (big(st.needNear) > BigInt(0)) {
      var w = [];
      if (big(st.wrapReg) > BigInt(0)) w.push(fc('storage_deposit', { account_id: st.me, registration_only: true }, 10, st.wrapReg));
      w.push(fc('near_deposit', {}, 10, st.needNear));
      w.push(fc('ft_transfer_call', { receiver_id: REF, amount: st.needNear, msg: '' }, 100, '1'));
      txs.push({ receiverId: WNEAR, actions: w });
    }
    if (big(st.needTok) > BigInt(0)) {
      txs.push({ receiverId: token, actions: [fc('ft_transfer_call', { receiver_id: REF, amount: st.needTok, msg: '' }, 100, '1')] });
    }
    txs.push({ receiverId: REF, actions: [fc('add_liquidity', {
      pool_id: Number(st.poolId), amounts: [st.poolRaw, st.liq], min_amounts: [less(st.poolRaw, 10), less(st.liq, 10)]
    }, 50, L().REF_LIQ_DEPOSIT)] });
    return txs;
  }

  // st: { poolId, shares (raw, the launcher's whole balance), registered (is the lock account on the pool) }
  // THE LOCK (RAZA 2026-11-03), the fourth approval: every share the launcher holds goes to the all-zeros account
  // (nearlaunch.js LOCK_ACCOUNT -- no keys, no contract, nobody can withdraw). It cannot ride in the liquidity
  // transaction: Rhea's first deposit does not mint a fixed number of shares (recent pools hold 1e24, 4.7e20,
  // 2.4e20 ...), and mft_transfer needs the exact amount, so it is read from the chain once the liquidity lands.
  function buildLockTxs(st) {
    var acts = [];
    if (!st.registered) acts.push(fc('mft_register', { token_id: ':' + st.poolId, account_id: L().LOCK_ACCOUNT }, 30, L().LOCK_REG_DEPOSIT));
    acts.push(fc('mft_transfer', { token_id: ':' + st.poolId, receiver_id: L().LOCK_ACCOUNT, amount: String(st.shares),
      memo: 'LumosCore launch: liquidity locked' }, 30, '1'));
    return [{ receiverId: L().REF, actions: acts }];
  }

  // ---- signing --------------------------------------------------------------------------------------------
  function signTxs(me, txs) {
    if (!window.lxn || typeof window.lxn.wallet !== 'function') return Promise.reject(new Error('Connect a NEAR wallet first.'));
    return window.lxn.wallet().then(function (w) {
      if (!w) throw new Error('No NEAR wallet is connected.');
      if (txs.length === 1) {
        if (typeof w.signAndSendTransaction !== 'function') throw new Error('This wallet cannot sign transactions here.');
        return w.signAndSendTransaction({ signerId: me, receiverId: txs[0].receiverId, actions: txs[0].actions })
          .then(function (r) { return [r]; });
      }
      if (typeof w.signAndSendTransactions !== 'function') throw new Error('This wallet cannot sign several transactions at once.');
      return w.signAndSendTransactions({ signerId: me, transactions: txs });
    });
  }
  function decodeValue(o) {
    var st = o && o.status;
    if (!st || typeof st !== 'object' || st.SuccessValue == null) return undefined;
    try {
      var bin = atob(st.SuccessValue), bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      var txt = new TextDecoder().decode(bytes);
      return txt ? JSON.parse(txt) : null;
    } catch (e) { return undefined; }
  }
  function failed(o) { return !!(o && o.status && typeof o.status === 'object' && o.status.Failure); }
  function hashOf(o) { return (o && ((o.transaction && o.transaction.hash) || (o.transaction_outcome && o.transaction_outcome.id))) || ''; }
  function blockOf(o) { return (o && o.transaction_outcome && o.transaction_outcome.block_hash) || ''; }
  function outcomeFor(outs, receiver) {
    var arr = Array.isArray(outs) ? outs : [];
    for (var i = arr.length - 1; i >= 0; i--) {
      var o = arr[i];
      if (o && o.transaction && o.transaction.receiver_id === receiver) return o;
    }
    return null;
  }
  function rejected(e) { return /reject|denied|cancel|closed|declin|user/i.test(String((e && e.message) || e || '')); }
  function failMsg(o) {
    try { return JSON.stringify(o.status.Failure).slice(0, 220); } catch (e) { return 'failed'; }
  }

  // ---- chain reads ----------------------------------------------------------------------------------------
  // The token exists and holds the launcher's whole supply. Polled, because 'final' lags a successful
  // transaction by a couple of seconds.
  function tokenLanded(token, me, totalRaw, tries) {
    var n = tries == null ? 8 : tries;
    return L().viewAccount(token).then(function (r) {
      if (!r.exists) return false;
      return L().callView(token, 'ft_total_supply', {}).then(function (s) { return String(s) === String(totalRaw); });
    }, function () { return null; }).then(function (ok) {
      if (ok || n <= 0) return !!ok;
      return wait(1500).then(function () { return tokenLanded(token, me, totalRaw, n - 1); });
    });
  }
  // A [token, wrap.near] simple pool, searched backwards from the newest. Only used when the wallet
  // returned no outcome to read the id from, or on a retry.
  function findPool(token) {
    var WNEAR = L().WNEAR;
    return L().callView(L().REF, 'get_number_of_pools', {}).then(function (n) {
      n = Number(n) || 0;
      var from = Math.max(0, n - 300);
      return L().callView(L().REF, 'get_pools', { from_index: from, limit: n - from }).then(function (ps) {
        for (var i = (ps || []).length - 1; i >= 0; i--) {
          var p = ps[i], t = (p && p.token_account_ids) || [];
          if (p.pool_kind === 'SIMPLE_POOL' && t.length === 2 && t[0] === token && t[1] === WNEAR) return from + i;
        }
        return null;
      });
    });
  }
  function checkPool(id, token) {
    return L().callView(L().REF, 'get_pool', { pool_id: Number(id) }).then(function (p) {
      var t = (p && p.token_account_ids) || [];
      return !!(p && t.length === 2 && t.indexOf(token) >= 0 && t.indexOf(L().WNEAR) >= 0);
    });
  }

  // ---- the status box (same placement as the XRPL launch: between the hero and the first detail card) ----
  function status(html) {
    var box = $('#lxnMintStatus');
    if (!box) {
      box = document.createElement('div');
      box.id = 'lxnMintStatus';
      box.setAttribute('role', 'status');
      box.style.cssText = 'margin:18px 0;padding:16px 18px;border-radius:14px;font-size:13.5px;line-height:1.7;'
        + 'background:var(--surface-2,rgba(127,127,127,.07));color:var(--text,inherit);border:1px solid var(--border,rgba(127,127,127,.22));'
        + 'word-break:break-word';
      var detail = $('.detail-card');
      if (detail && detail.parentElement) detail.parentElement.insertBefore(box, detail);
      else { var main = $('main.page') || document.body; main.insertBefore(box, main.firstChild); }
    }
    box.innerHTML = html;
    try { box.scrollIntoView({ block: 'nearest' }); } catch (e) {}
    return box;
  }

  // ---- the button --------------------------------------------------------------------------------------------
  function cta() {
    return $$('a.btn-primary, button.btn-primary, a, button').filter(function (e) {
      var t = (e.textContent || '').replace(/\s+/g, ' ').trim();
      return /confirm\s*&\s*launch/i.test(t) || t === L().SOON || t === RETRY || e.__lxnCta;
    })[0] || null;
  }
  function setCta(label, enabled) {
    var el = cta();
    if (!el) return;
    el.__lxnCta = 1;
    if (el.tagName === 'A') { el.removeAttribute('href'); el.setAttribute('role', 'button'); }
    var tn = null;
    for (var n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 3 && n.nodeValue.trim()) { tn = n; break; }
    if (tn) { if (tn.nodeValue.trim() !== label) tn.nodeValue = ' ' + label + ' '; }
    else el.insertBefore(document.createTextNode(label + ' '), el.firstChild);
    el.__lxnEnabled = !!enabled;
    if (enabled) { el.removeAttribute('disabled'); el.removeAttribute('aria-disabled'); el.style.pointerEvents = ''; el.style.opacity = ''; el.style.cursor = ''; }
    else { el.setAttribute('disabled', ''); el.setAttribute('aria-disabled', 'true'); el.style.pointerEvents = 'none'; el.style.opacity = '.55'; el.style.cursor = 'not-allowed'; }
    try { document.documentElement.classList.add('lxn-lpgate'); } catch (e) {}
  }

  // A partial launch of THIS draft, by THIS account, that the review page can finish.
  function pendingFor(d, me) {
    var r = L().readResult();
    if (!r || r.stage === 'done' || !d) return null;
    if (String(r.ticker || '').toUpperCase() !== String(d.ticker || '').toUpperCase()) return null;
    if (me && r.owner && r.owner !== me) return null;
    return r;
  }

  var running = false;
  var decided = false;
  function gate() {
    var d = L().readDraft(), me = L().account();
    var pend = pendingFor(d, me);
    if (pend) {
      decided = true;
      setCta(RETRY, true);
      status(pend.stage === 'liquidity'
        ? ('<strong>' + esc(pend.token) + '</strong> is trading on Rhea, but its liquidity is <strong>not locked yet</strong>. '
          + 'Press <strong>' + RETRY + '</strong> to lock it — nothing already done is repeated.')
        : '<strong>' + esc(pend.token) + '</strong> exists and holds your full supply, but its Rhea pool did not finish. '
        + 'Press <strong>' + RETRY + '</strong> to complete it — nothing already done is repeated.');
      return Promise.resolve();
    }
    return L().config(true).then(function (c) {
      decided = true;
      if (c.paused) setCta(L().SOON, false);
      else setCta(LAUNCH, true);
    }, function () { decided = true; setCta(L().SOON, false); });
  }

  // ---- the launch ---------------------------------------------------------------------------------------------
  var log = [];
  function step(i, text, state) {
    log[i] = (state === 'done' ? '✓ ' : (state === 'fail' ? '✕ ' : '· ')) + esc(text) + (state === 'run' ? '…' : '');
    status(log.filter(Boolean).join('<br>'));
  }
  function stop(msg, res) {
    running = false;
    var tail = '';
    if (res && res.token) {
      tail = '<br><br>Your token <code>' + esc(res.token) + '</code> exists and holds your full supply. '
        + 'Press <strong>' + RETRY + '</strong> to finish the pool — or <a href="/launchpad/confirm">see what was done</a>.';
      setCta(RETRY, true);
    } else {
      setCta(LAUNCH, true);
    }
    var done = log.filter(Boolean).join('<br>');
    status((done ? done + '<br><br>' : '') + '<strong>Stopped: ' + esc(msg) + '</strong>' + tail);
  }

  function runLaunch() {
    var d = L().readDraft(), me = L().account();
    if (!d || d.chain !== 'near') { status('No token details found — start again from the form.'); return; }
    if (!me) { status('Connect a NEAR wallet first.'); return; }
    var v = L().validate(d);
    if (!v.ok) { status(esc(v.errs.join(' '))); return; }
    var pend = pendingFor(d, me);
    running = true;
    log = [];
    setCta(pend ? RETRY : LAUNCH, false);
    if (pend) return resume(pend, me);

    status('Checking NEAR…');
    var fac = L().factory(), args = L().argsOf(d), token = L().tokenIdOf(d.ticker);
    var ctx = {};
    L().config(true).then(function (c) {
      if (c.paused) throw new Error('Launches are paused on the NEAR token factory right now.');
      ctx.cfg = c;
      return L().viewAccount(token);
    }).then(function (acc) {
      if (acc.exists) throw new Error('$' + args.symbol + ' is already taken on NEAR (' + token + ' exists). Edit the ticker and try again.');
      return L().callView(fac, 'required_deposit', { args: args }).catch(function (e) {
        // The factory validates the arguments in this view, so its refusal is the sentence to show.
        throw new Error('The NEAR token factory refused these details: ' + ((e && e.message) || e));
      });
    }).then(function (req) {
      ctx.required = String(req);
      return Promise.all([
        L().callView(fac, 'storage_cost_of', { args: args }),
        L().rateLive(),
        L().accountState(me, token),
        L().spendable(me)
      ]);
    }).then(function (r) {
      ctx.storage = String(r[0]); ctx.rate = r[1]; ctx.st = r[2]; ctx.spend = r[3];
      var p = L().costPlan(d, ctx.rate, { cfg: ctx.cfg, storage: ctx.storage, refAcct: ctx.st.refAcct, wrapReg: ctx.st.wrapReg });
      ctx.plan = p;
      if (L().big(p.createDeposit) < L().big(ctx.required)) throw new Error('The launch deposit came out below what the factory requires — reload and try again.');
      var need = L().big(p.total) + L().big(GAS_MARGIN);
      if (L().big(ctx.spend) < need) {
        throw new Error('Not enough NEAR. This launch needs about ' + L().fmtNear(need.toString()) + ' including gas, and '
          + me + ' can spend ' + L().fmtNear(ctx.spend) + '. Nothing has been sent.');
      }
      step(0, 'Create ' + token + ' and mint ' + Number(d.supply).toLocaleString('en-US') + ' ' + args.symbol + ' to you', 'run');
      step(1, 'Set up its Rhea pool', 'wait');
      step(2, 'Add the starting liquidity', 'wait');
      var tx = buildCreateTx(p);
      return signTxs(me, [tx]).then(function (outs) { return { outs: outs }; }, function (e) { return { err: e }; });
    }).then(function (sent) {
      var o = sent.outs && sent.outs[0];
      var said = decodeValue(o);
      if (said === false) throw new Error('The factory refunded your deposit — ' + token + ' was created by someone else a moment earlier. Edit the ticker and try again.');
      if (failed(o)) throw new Error('The token was not created (' + failMsg(o) + '). The factory refunds the whole deposit on failure.');
      // No definite outcome (the wallet threw, or returned nothing): ask the chain. A refusal in the wallet
      // is checked once; anything else is polled, because the transaction may still be landing.
      var poll = (sent.err && rejected(sent.err)) ? 0 : 8;
      return (said === true ? Promise.resolve(true) : tokenLanded(token, me, args.total_supply, poll)).then(function (ok) {
        if (!ok) {
          throw new Error(sent.err ? (rejected(sent.err) ? 'The wallet did not approve the launch. Nothing was sent.'
            : ('The wallet reported: ' + ((sent.err && sent.err.message) || sent.err) + '. No token was created.'))
            : 'The token did not appear on NEAR. The factory refunds the whole deposit on failure.');
        }
        var p = ctx.plan, now = Date.now();
        var res = {
          ok: false, stage: 'token', owner: me, factory: fac, token: token, name: args.name, ticker: args.symbol,
          supply: Number(d.supply), share: Number(d.share), decimals: args.decimals, totalRaw: args.total_supply,
          poolRaw: p.poolRaw, liqYocto: p.liq, createDeposit: p.createDeposit, paidYocto: p.createDeposit,
          rate: ctx.rate, icon: d.icon || null, poolId: null,
          hashes: { create: hashOf(o) }, blockHash: blockOf(o), at: { create: now }
        };
        L().writeResult(res);
        step(0, 'Created ' + token, 'done');
        return poolAndLiquidity(res, me);
      });
    }).catch(function (e) {
      if (e && e.__handled) return;
      var r = L().readResult();
      stop((e && e.message) || String(e), (r && r.token === token && r.stage !== 'done') ? r : null);
    });
  }

  function resume(res, me) {
    log = [];
    step(0, 'Created ' + res.token, 'done');
    step(1, 'Set up its Rhea pool', res.poolId != null ? 'done' : 'wait');
    if (res.stage === 'liquidity') {
      step(2, 'Liquidity added', 'done');
      lockStep(res, me).catch(function (e) { stop((e && e.message) || String(e), L().readResult()); });
      return;
    }
    step(2, 'Add the starting liquidity', 'wait');
    step(3, 'Lock the liquidity', 'wait');
    poolAndLiquidity(res, me).catch(function (e) { stop((e && e.message) || String(e), L().readResult()); });
  }

  function poolAndLiquidity(res, me) {
    var token = res.token, REF = L().REF;
    var p = Promise.resolve();
    if (res.poolId == null) {
      p = p.then(function () {
        step(1, 'Set up its Rhea pool', 'run');
        return Promise.all([
          L().callView(token, 'storage_balance_of', { account_id: REF }),
          L().callView(token, 'storage_balance_bounds', {}),
          L().accountState(me, token),
          L().callView(REF, 'get_user_whitelisted_tokens', { account_id: me }).catch(function () { return []; }),
          findPool(token).catch(function () { return null; })
        ]);
      }).then(function (r) {
        var min = r[1] && r[1].min != null ? String(r[1].min) : '';
        if (!r[0] && !/^[0-9]+$/.test(min)) throw new Error('The new token did not say what registering Rhea costs.');
        var st = {
          me: me, refNeedsTokenReg: !r[0], tokenRegMin: min, refAcct: r[2].refAcct,
          registered: (r[3] || []).indexOf(token) >= 0, pool: r[4]
        };
        var txs = buildPoolTxs(token, st);
        if (st.pool != null && !st.refNeedsTokenReg && L().big(st.refAcct) === BigInt(0) && st.registered) return { pool: st.pool };
        return signTxs(me, txs).then(function (outs) { return { outs: outs, pool: st.pool, paid: sumDeposits(txs) }; }, function (e) {
          // The wallet may have sent it anyway; a pool for this token on Rhea settles the question.
          return wait(rejected(e) ? 0 : 3000).then(function () { return findPool(token).catch(function () { return null; }); })
            .then(function (found) {
              if (found == null) throw new Error(rejected(e) ? 'The wallet did not approve the pool step.' : ('The wallet reported: ' + ((e && e.message) || e)));
              return { pool: found, paid: sumDeposits(txs) };
            });
        });
      }).then(function (got) {
        var o = got.outs ? outcomeFor(got.outs, REF) : null;
        if (o && failed(o)) throw new Error('Rhea refused the pool step (' + failMsg(o) + ').');
        var tok = got.outs ? outcomeFor(got.outs, token) : null;
        if (tok && failed(tok)) throw new Error('Registering Rhea on the token failed (' + failMsg(tok) + ').');
        var id = got.pool;
        if (id == null && o) { var v = decodeValue(o); if (typeof v === 'number' || /^[0-9]+$/.test(String(v))) id = Number(v); }
        return (id == null ? findPool(token) : Promise.resolve(id)).then(function (pid) {
          if (pid == null) throw new Error('The pool was not found on Rhea after the pool step.');
          return checkPool(pid, token).then(function (ok) {
            if (!ok) throw new Error('Rhea pool #' + pid + ' is not a ' + res.ticker + ' / wNEAR pool — stopped before adding liquidity.');
            res.poolId = Number(pid); res.stage = 'pool';
            res.hashes.pool = hashOf(o) || res.hashes.pool || '';
            res.at.pool = Date.now();
            res.paidYocto = (L().big(res.paidYocto) + L().big(got.paid || '0')).toString();
            L().writeResult(res);
            step(1, 'Rhea pool #' + pid + ' created', 'done');
          });
        });
      });
    }
    return p.then(function () {
      step(2, 'Add the starting liquidity', 'run');
      return Promise.all([
        L().callView(REF, 'get_deposits', { account_id: me }).catch(function () { return {}; }),
        L().callView(L().WNEAR, 'storage_balance_of', { account_id: me }),
        L().callView(L().WNEAR, 'storage_balance_bounds', {})
      ]);
    }).then(function (r) {
      var deps = r[0] || {}, big = L().big;
      var haveTok = big(deps[token] || '0'), haveNear = big(deps[L().WNEAR] || '0');
      var needTok = big(res.poolRaw) > haveTok ? (big(res.poolRaw) - haveTok).toString() : '0';
      var needNear = big(res.liqYocto) > haveNear ? (big(res.liqYocto) - haveNear).toString() : '0';
      var wrapReg = r[1] ? '0' : String((r[2] && r[2].min) || '');
      if (!/^[0-9]+$/.test(wrapReg)) throw new Error('wrap.near did not say what registering costs.');
      var txs = buildLiquidityTxs(token, { me: me, poolId: res.poolId, needNear: needNear, needTok: needTok,
        wrapReg: wrapReg, poolRaw: res.poolRaw, liq: res.liqYocto });
      return signTxs(me, txs).then(function (outs) { return { outs: outs, paid: sumDeposits(txs) }; }, function (e) { return { err: e, paid: sumDeposits(txs) }; });
    }).then(function (sent) {
      var o = sent.outs ? outcomeFor(sent.outs, REF) : null;
      if (o && failed(o)) throw new Error('Rhea did not add the liquidity (' + failMsg(o) + '). Anything deposited stays in your Rhea account and is reused on retry.');
      return L().callView(REF, 'get_pool_shares', { pool_id: Number(res.poolId), account_id: me }).then(function (sh) {
        if (!(L().big(sh || '0') > BigInt(0))) {
          throw new Error(sent.err ? (rejected(sent.err) ? 'The wallet did not approve the liquidity step.' : ('The wallet reported: ' + ((sent.err && sent.err.message) || sent.err)))
            : 'The liquidity did not reach the pool. Anything deposited stays in your Rhea account and is reused on retry.');
        }
        res.stage = 'liquidity';
        res.hashes.liquidity = hashOf(o) || '';
        res.at.liquidity = Date.now();
        res.paidYocto = (L().big(res.paidYocto) + L().big(sent.paid || '0')).toString();
        L().writeResult(res);
        step(2, 'Liquidity added — your token is trading on Rhea', 'done');
        return lockStep(res, me);
      });
    });
  }
  // ---- step 4: lock the liquidity --------------------------------------------------------------------------
  function lockStep(res, me) {
    var REF = L().REF, id = Number(res.poolId), tid = ':' + id, big = L().big;
    step(3, 'Lock the liquidity in the pool for good', 'run');
    return Promise.all([
      L().callView(REF, 'get_pool_shares', { pool_id: id, account_id: me }),
      L().callView(REF, 'mft_has_registered', { token_id: tid, account_id: L().LOCK_ACCOUNT }),
      L().callView(REF, 'get_pool_shares', { pool_id: id, account_id: L().LOCK_ACCOUNT }).catch(function () { return '0'; })
    ]).then(function (r) {
      var mine = String(r[0] || '0'), locked = String(r[2] || '0');
      if (!(big(mine) > BigInt(0))) {
        if (big(locked) > BigInt(0)) return { already: true };
        throw new Error('No pool shares were found in your account to lock.');
      }
      var txs = buildLockTxs({ poolId: id, shares: mine, registered: r[1] === true });
      return signTxs(me, txs).then(function (outs) { return { outs: outs, paid: sumDeposits(txs) }; }, function (e) { return { err: e, paid: '0' }; });
    }).then(function (sent) {
      var o = sent.outs ? outcomeFor(sent.outs, REF) : null;
      if (o && failed(o)) throw new Error('Rhea did not move the pool shares (' + failMsg(o) + '). Your liquidity is in the pool but NOT locked yet.');
      return Promise.all([
        L().callView(REF, 'get_pool_shares', { pool_id: id, account_id: me }),
        L().callView(REF, 'get_pool_shares', { pool_id: id, account_id: L().LOCK_ACCOUNT })
      ]).then(function (r) {
        if (big(r[0] || '0') > BigInt(0) || !(big(r[1] || '0') > BigInt(0))) {
          throw new Error(sent.err ? (rejected(sent.err) ? 'The wallet did not approve the lock step. Your liquidity is in the pool but NOT locked yet.'
            : ('The wallet reported: ' + ((sent.err && sent.err.message) || sent.err) + '. Your liquidity is in the pool but NOT locked yet.'))
            : 'The lock did not land. Your liquidity is in the pool but NOT locked yet.');
        }
        res.stage = 'done'; res.ok = true; res.locked = true;
        if (o) res.hashes.lock = hashOf(o) || '';
        res.at.lock = Date.now();
        res.paidYocto = (big(res.paidYocto) + big(sent.paid || '0')).toString();
        L().writeResult(res);
        step(3, 'Liquidity locked — nobody can withdraw it, not you and not us', 'done');
        running = false;
        status(log.filter(Boolean).join('<br>') + '<br><br><strong>Launched.</strong> Opening your confirmation…');
        // /launchpad/confirm is one url for every chain, served by the lx_chain cookie: re-state it first.
        try { document.cookie = 'lx_chain=near; path=/; max-age=31536000; SameSite=Lax'; } catch (e) {}
        setTimeout(function () { try { location.assign('/launchpad/confirm'); } catch (e) {} }, 900);
      });
    });
  }

  // Every yocto attached across a group of transactions: what "Total paid" reports. Rhea refunds the unused
  // part of its storage deposits, so the real cost is slightly lower; it is never higher.
  function sumDeposits(txs) {
    var t = BigInt(0);
    (txs || []).forEach(function (tx) { (tx.actions || []).forEach(function (a) { t += L().big(a.params.deposit); }); });
    return t.toString();
  }

  // ---- wiring -------------------------------------------------------------------------------------------------
  function wire() {
    // Capture at WINDOW: the design's link and any inherited listener never see a click on this button.
    window.addEventListener('click', function (ev) {
      var el = ev.target && ev.target.closest ? ev.target.closest('a,button') : null;
      if (!el) return;
      var t = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (!(el.__lxnCta || /confirm\s*&\s*launch/i.test(t) || t === L().SOON || t === RETRY)) return;
      ev.preventDefault(); ev.stopImmediatePropagation();
      if (running || !el.__lxnEnabled) return;
      runLaunch();
    }, true);
    // The CTA is held hidden by the head stylesheet until gate() has decided its label. If NEAR never
    // answers, the safe answer is the disabled one.
    setTimeout(function () { if (!decided) { decided = true; setCta(L().SOON, false); } }, 10000);
    gate();
  }
  function load() {
    if (!$('.detail-row') || !L()) return;            // the review page only
    var d = L().readDraft();
    if (!d || d.chain !== 'near') return;             // nearlaunch.js is already sending this page back
    wire();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load);
  else load();

  window.__lxnLaunchPlan = { buildCreateTx: buildCreateTx, buildPoolTxs: buildPoolTxs, buildLiquidityTxs: buildLiquidityTxs, buildLockTxs: buildLockTxs,
    decodeValue: decodeValue, findPool: findPool, gate: gate, run: runLaunch };
})();
