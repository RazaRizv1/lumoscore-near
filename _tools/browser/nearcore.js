// NEAR reads shared by the Wallet page, the Account page and the header search: FastNEAR RPC (view_account,
// ft_metadata), FastNEAR's token-balance index, /lxapi/nearmarket, and activity (FastNEAR's transaction
// index; NearBlocks only as a fallback -- see fnActivity).
//
// MOVED OUT OF browser/wallet.js (2026-10-21), verbatim, so a second page could read any account without a
// second implementation of balances. wallet.js reaches these through window.lxnCore and makes the same calls
// in the same order as before. Guarded, so a page that injects it twice (wallet + search) runs it once.
//
// Nothing here runs on load: every function asks only when called.
(function () {
  if (window.lxnCore) return;

  var RPC = 'https://free.rpc.fastnear.com';
  var FT_API = 'https://api.fastnear.com/v1/account/';
  var NB = 'https://api.nearblocks.io/v1/account/';
  var WNEAR = 'wrap.near';
  var NEAR_LOGO = '/assets/networks/near.png';

  function short(a) { return a && a.length > 12 ? a.slice(0, 5) + '…' + a.slice(-4) : (a || ''); }

  // The market answer, shared with prices.js so the page asks once. A failed answer is never kept as
  // THE answer: the promise is dropped so the next caller asks again.
  function market() {
    if (!window.__lxnMarketP) {
      var p = fetch('/lxapi/nearmarket').then(function (r) { return r.json(); })
        .then(function (d) { return (d && d.ok && d.rows) ? d : null; }, function () { return null; });
      window.__lxnMarketP = p;
      p.then(function (d) { if (!d && window.__lxnMarketP === p) window.__lxnMarketP = null; });
    }
    return window.__lxnMarketP;
  }

  // NEAR READS go to FastNEAR's free JSON-RPC. A 429, or a request that never arrived, is "ask later":
  // waited out and asked again (twice). An answer from the node -- an account that does not exist, a
  // contract with no such method -- is a real answer and is reported, never retried.
  function view(params, attempt) {
    return fetch(RPC, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 'lx', method: 'query', params: params })
    }).then(function (r) {
      if (r.status === 429 || r.status >= 500) { var e1 = new Error('NEAR RPC busy (' + r.status + ')'); e1.transient = 1; throw e1; }
      return r.json();
    }, function () {
      var e0 = new Error('NEAR RPC unreachable'); e0.transient = 1; throw e0;
    }).then(function (j) {
      var err = j && j.error;
      if (err) {
        var e = new Error(String((err.cause && err.cause.name) || err.message || err.name || 'RPC error'));
        e.code = (err.cause && err.cause.name) || '';
        throw e;
      }
      if (j && j.result && j.result.error) { var e2 = new Error(String(j.result.error)); e2.code = 'CALL'; throw e2; }
      return j.result;
    }).catch(function (e) {
      if (!(e && e.transient) || (attempt || 0) >= 2) throw e;
      return new Promise(function (r) { setTimeout(r, 900 + 900 * (attempt || 0)); })
        .then(function () { return view(params, (attempt || 0) + 1); });
    });
  }

  // A contract view method, its JSON answer decoded. Args go base64 as the RPC requires.
  function callView(contract, method, args) {
    return view({
      request_type: 'call_function', finality: 'final', account_id: contract,
      method_name: method, args_base64: btoa(JSON.stringify(args || {}))
    }).then(function (r) {
      var bytes = new Uint8Array((r && r.result) || []);
      var txt = '';
      try { txt = new TextDecoder().decode(bytes); } catch (e) { for (var i = 0; i < bytes.length; i++) txt += String.fromCharCode(bytes[i]); }
      return txt ? JSON.parse(txt) : null;
    });
  }

  // Raw integer units -> a display number, by string arithmetic: a yoctoNEAR balance has 24 decimals and
  // does not survive a trip through a float before the decimal point is placed.
  function units(raw, dec) {
    var s = String(raw == null ? '0' : raw).replace(/^0+/, '') || '0';
    if (!/^[0-9]+$/.test(s)) return 0;
    dec = +dec || 0;
    if (dec <= 0) return +s;
    while (s.length <= dec) s = '0' + s;
    return +(s.slice(0, s.length - dec) + '.' + s.slice(s.length - dec));
  }

  // ---- token metadata -------------------------------------------------------------------------------
  // Symbol and decimals for tokens the curated list does not carry. Remembered in localStorage (they do
  // not change); icons are NOT stored there -- a single data: icon can be 50KB -- but kept in memory for
  // the page view that fetched them, and otherwise asked for when a row comes near the screen.
  var META_KEY = 'lxn.ftmeta.v1', META = null, ICONS = {};
  function metaStore() {
    if (META) return META;
    try { META = JSON.parse(localStorage.getItem(META_KEY) || '{}') || {}; } catch (e) { META = {}; }
    return META;
  }
  function metaSave() { try { localStorage.setItem(META_KEY, JSON.stringify(META || {})); } catch (e) {} }
  var MQ = [], mActive = 0;
  function mPump() {
    while (mActive < 3 && MQ.length) {
      mActive++;
      (MQ.shift())(function () { mActive--; mPump(); });
    }
  }
  function ftMetadata(id) {
    return new Promise(function (res, rej) {
      MQ.push(function (done) {
        callView(id, 'ft_metadata', {}).then(function (m) { done(); res(m); }, function (e) { done(); rej(e); });
      });
      mPump();
    });
  }
  function cleanSym(v) { return String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, '').slice(0, 24); }
  // Resolves { s, d, n } for one contract, or null when the contract answers that it is not a token.
  // A transient failure rejects, so the caller can tell "not a token" from "could not ask".
  function tokenMeta(id) {
    var st = metaStore();
    if (st[id]) return Promise.resolve(st[id]);
    return ftMetadata(id).then(function (m) {
      if (!m || m.decimals == null || !isFinite(+m.decimals)) { st[id] = { x: 1 }; metaSave(); return st[id]; }
      var v = { s: cleanSym(m.symbol) || '?', d: +m.decimals, n: cleanSym(m.name) };
      if (m.icon) ICONS[id] = m.icon;
      st[id] = v; metaSave();
      return v;
    }, function (e) {
      if (e && e.code === 'CALL') { st[id] = { x: 1 }; metaSave(); return st[id]; }
      throw e;
    });
  }
  // The connected account's (or any account's) holdings: NEAR balance from view_account, every
  // NEP-141 balance FastNEAR indexes, decimals/logos/prices from the curated list, ft_metadata for the
  // rest under a 4s cold-load cap. Moved verbatim out of wallet.js load(); resolves { near, held, pools }.
  function readHoldings(a) {
    return Promise.all([
      view({ request_type: 'view_account', finality: 'final', account_id: a }),
      fetch(FT_API + encodeURIComponent(a) + '/ft').then(function (r) {
        if (!r.ok) throw new Error('token balances unavailable (' + r.status + ')');
        return r.json();
      }),
      market()
    ]).then(function (r) {
      var acct = r[0] || {}, mk = r[2];
      var balance = units(acct.amount, 24), staked = units(acct.locked, 24);
      var storage = (+acct.storage_usage || 0) / 1e5;                 // storage_usage bytes x 1e19 yocto
      var near = {
        balance: balance, staked: staked, storage: storage, raw: String(acct.amount || '0'),
        spendable: Math.max(0, balance - Math.max(0, storage - staked))
      };

      var byId = {};
      ((mk && mk.rows) || []).forEach(function (row) { if (row && row.i) byId[row.i] = row; });
      var toks = ((r[1] && r[1].tokens) || []).filter(function (t) {
        var b = String((t && t.balance) || '');
        return t && t.contract_id && /^[0-9]+$/.test(b) && !/^0+$/.test(b);
      });

      // A DEADLINE ON UNKNOWN TOKENS. Measured on root.near (179 tokens, 156 uncurated) from a cold browser:
      // FastNEAR answers 429 to a share of ft_metadata reads even three at a time, and waiting for every
      // one held the whole list behind "Reading…" for ~50s. So the list paints at 4s with whatever is
      // known; a token still unanswered is listed under its contract with its balance unknown, and the
      // queue keeps filling the cache, so the next view has it. One paint, never a list that reshuffles.
      var deadline = new Promise(function (res) { setTimeout(function () { res('late'); }, 4000); });
      return Promise.all(toks.map(function (t) {
        var id = String(t.contract_id), row = byId[id];
        var unknown = { id: id, sym: short(id), dec: null, logo: '', p: row ? row.p : null, cur: !!row, raw: t.balance };
        if (id === WNEAR) return Promise.resolve({ id: id, sym: 'wNEAR', dec: 24, logo: NEAR_LOGO, p: 1, cur: true, raw: t.balance });
        if (row && row.dc != null) return Promise.resolve({ id: id, sym: cleanSym(row.n), dec: +row.dc, logo: row.logo || '', p: row.p, cur: true, raw: t.balance });
        var asked = tokenMeta(id).then(function (m) {
          if (m.x) return null;                                         // answers, but is not a token
          return { id: id, sym: m.s, dec: m.d, logo: '', p: row ? row.p : null, cur: !!row, raw: t.balance };
        }, function () {
          // Could not ask: listed under its contract, balance unknown, rather than silently dropped.
          return unknown;
        });
        return Promise.race([asked, deadline.then(function () { return unknown; })]);
      })).then(function (list) {
        var held = [];
        list.forEach(function (x) {
          if (!x) return;
          var bal = x.dec == null ? null : units(x.raw, x.dec);
          held.push({
            id: x.id, display: x.sym || '?', symbol: x.sym, balance: bal, raw: String(x.raw), dec: x.dec,
            logo: x.logo, curated: x.cur, priceNear: (x.p != null && isFinite(x.p)) ? +x.p : null
          });
        });
        // Priced holdings by what they are worth, then everything else by name: a balance is not
        // comparable across tokens with different decimals and prices.
        held.sort(function (p, q) {
          var vp = (p.priceNear != null && p.balance != null) ? p.balance * p.priceNear : -1;
          var vq = (q.priceNear != null && q.balance != null) ? q.balance * q.priceNear : -1;
          if (vp !== vq) return vq - vp;
          return String(p.display).localeCompare(String(q.display));
        });
        var data = { near: near, held: held, pools: [] };
        return data;
      });
    });
  }

  function nbGet(me, path) {
    return fetch(NB + encodeURIComponent(me) + path).then(function (r) {
      if (r.status === 429) { var e = new Error('busy'); e.code = 429; throw e; }
      if (!r.ok) throw new Error('nearblocks ' + r.status);
      return r.json();
    });
  }
  function nsMs(ts) { var s0 = String(ts || ''); return s0.length > 6 ? +s0.slice(0, s0.length - 6) : 0; }

  // Normalised before caching: NearBlocks rows carry every token's full icon, which would fill
  // sessionStorage with the same artwork twenty-five times.
  function normFt(f) {
    var ft = f.ft || {}, d = String(f.delta_amount || '0'), neg = d.charAt(0) === '-';
    var ic = String(ft.icon || '');
    return {
      ts: nsMs(f.block_timestamp), h: f.transaction_hash || '', neg: neg,
      v: units(neg ? d.slice(1) : d, ft.decimals), c: String(ft.contract || ''),
      s: cleanSym(ft.symbol) || '?', ic: ic.length <= 12000 ? ic : '', inv: f.involved_account_id || '',
      cause: f.cause || '', ok: !(f.outcomes && f.outcomes.status === false)
    };
  }
  function normTx(t) {
    return {
      ts: nsMs(t.block_timestamp), h: t.transaction_hash || '', sg: t.signer_account_id || '', rc: t.receiver_account_id || '',
      acts: (t.actions || []).map(function (a) { return { a: a.action || '', m: a.method || '', dep: +a.deposit || 0 }; }),
      ok: !(t.outcomes && t.outcomes.status === false)
    };
  }

  function activityData(me) {
    var key = 'lxn.act.' + me;
    try {
      var c = JSON.parse(sessionStorage.getItem(key) || 'null');
      if (c && Date.now() - c.t < 60000 && c.txns && c.fts) return Promise.resolve(c);
    } catch (e) {}
    var hold = 0;
    try { hold = +sessionStorage.getItem('lxn.act.hold') || 0; } catch (e) {}
    if (hold > Date.now()) { var eh = new Error('busy'); eh.code = 429; return Promise.reject(eh); }
    // FastNEAR first; NearBlocks only if FastNEAR cannot answer (its plain transaction list is current, so
    // the page still lists something, but its token history is the stale one described below).
    return fnActivity(me).catch(function (e) {
      if (e && e.code === 429) throw e;
      return Promise.all([nbGet(me, '/txns-only?per_page=25'), nbGet(me, '/ft-txns?per_page=25')]).then(function (r) {
        return { t: Date.now(), txns: ((r[0] && r[0].txns) || []).map(normTx), fts: ((r[1] && r[1].txns) || []).map(normFt) };
      });
    }).then(function (d) {
      try { sessionStorage.setItem(key, JSON.stringify(d)); } catch (e) {}
      return d;
    }, function (e) {
      if (e && e.code === 429) { try { sessionStorage.setItem('lxn.act.hold', String(Date.now() + 60000)); } catch (x) {} }
      throw e;
    });
  }

  // ACTIVITY FROM FASTNEAR'S TRANSACTION INDEX (RAZA 2026-11-01: "on Stellar public wallet page, it shows so
  // many things but on Near its the same thing"). NearBlocks' free token history (/ft-txns) STOPPED AT
  // 2026-09-30 -- checked on v2.ref-finance.near, whose newest token row was a month old while its plain
  // transaction list was minutes old -- so every account's last 25 rows were plain transactions and no
  // transfer or swap since October could appear. FastNEAR's index is current, needs no key and allows our
  // origin: /v0/account lists the account's transactions newest first (including ones it only appears in
  // through an event log), /v0/transactions returns them whole, 20 at a time, receipts and logs included.
  //
  // What moved, per transaction, from the chain's own records:
  //   tokens  NEP-141 event logs (ft_transfer / ft_mint / ft_burn) written by the token contract, for this
  //           account, from receipts that succeeded;
  //   NEAR    Transfer actions this account sent, a near_deposit it paid wrap.near (NEAR going in to be
  //           wrapped), and Transfers it received -- in someone else's transaction, or from wrap.near
  //           (an unwrap). Gas refunds (from "system") never count, nor the change a contract hands back
  //           in the account's own transaction (a storage refund is not income).
  // Netted per token, so a wrap-then-swap reads NEAR -> USDC, not three rows. The result has the shape the
  // NearBlocks reader produced ({ txns, fts }), so entriesOf and both pages read it unchanged.
  var FTX = 'https://tx.main.fastnear.com/v0/';
  var ACT_NAME = { Transfer: 'TRANSFER', FunctionCall: 'FUNCTION_CALL', AddKey: 'ADD_KEY', DeleteKey: 'DELETE_KEY',
    CreateAccount: 'CREATE_ACCOUNT', DeployContract: 'DEPLOY_CONTRACT', Stake: 'STAKE', DeleteAccount: 'DELETE_ACCOUNT' };
  function fnPost(path, body) {
    return fetch(FTX + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) {
        if (r.status === 429) { var e = new Error('busy'); e.code = 429; throw e; }
        if (!r.ok) throw new Error('fastnear ' + r.status);
        return r.json();
      });
  }
  function actPair(a) {
    if (typeof a === 'string') return [a, {}];
    var k = Object.keys(a || {})[0] || '';
    return [k, a[k] || {}];
  }
  function okOutcome(o) { var s = o && o.status; return !!s && (s.SuccessValue !== undefined || s.SuccessReceiptId !== undefined); }
  function big(v) { try { return BigInt(String(v)); } catch (e) { return BigInt(0); } }

  function fnActivity(me) {
    return fnPost('account', { account_id: me }).then(function (j) {
      var list = ((j && j.account_txs) || []).slice(0, 25), okBy = {};
      list.forEach(function (x) { okBy[x.transaction_hash] = x.is_success !== false; });
      var hs = list.map(function (x) { return x.transaction_hash; });
      // Five at a time, in parallel: the endpoint takes up to 20, but one call of 20 for omni.bridge.near took
      // 32s on the page and five calls of five took under 6s (2026-11-01). A batch that fails costs its own
      // rows only; all of them failing is a failure.
      var calls = [];
      for (var i = 0; i < hs.length; i += 5) calls.push(fnPost('transactions', { tx_hashes: hs.slice(i, i + 5) }).catch(function (e) { return { err: e }; }));
      return Promise.all(calls).then(function (rs) {
        var got = [], fails = rs.filter(function (r) { return r && r.err; });
        if (rs.length && fails.length === rs.length) throw fails[0].err;
        rs.forEach(function (r) { got = got.concat((r && r.transactions) || []); });
        var legs = [], txns = [];
        got.forEach(function (T) { decodeTx(me, T, okBy, txns, legs); });
        return withMeta(legs).then(function (fts) { return { t: Date.now(), txns: txns, fts: fts }; });
      });
    });
  }

  function decodeTx(me, T, okBy, txns, legs) {
    var tx = T.transaction || {}, h = tx.hash || '';
    var ts = nsMs((T.execution_outcome && T.execution_outcome.block_timestamp) || '');
    var ok = okBy[h] !== false;
    // A meta-transaction (relayed): the account that signed the inner actions is the one that acted.
    var sg = tx.signer_id || '', rc = tx.receiver_id || '', acts = tx.actions || [];
    if (acts.length === 1 && actPair(acts[0])[0] === 'Delegate') {
      var da = (actPair(acts[0])[1].delegate_action) || {};
      sg = da.sender_id || sg; rc = da.receiver_id || rc; acts = da.actions || [];
    }
    var row = { ts: ts, h: h, sg: sg, rc: rc, ok: ok, acts: acts.map(function (a) {
      var p = actPair(a), b = p[1];
      return { a: ACT_NAME[p[0]] || String(p[0]).toUpperCase(), m: b.method_name || '', dep: +b.deposit || 0 };
    }) };
    txns.push(row);

    // EVERY counterparty, kept on the transaction (wallet.js's bridge rows, RAZA 2026-11-10): the legs below net per token
    // and keep one name each, and a wrap that is sent straight on nets to nothing -- Omni's own name is then nowhere.
    var net = {}, who = {}, peers = {};
    function add(c, amt, other) { net[c] = (net[c] || BigInt(0)) + amt; if (other) { who[c] = other; peers[other] = 1; } }
    // NEAR that a contract unwrapped in this transaction ("Withdraw <x> NEAR from <contract>" on wrap.near) and
    // then paid on to this account is the proceeds of a sale (Rhea DCL unwraps for the seller), not change.
    var wd = {};
    (T.receipts || []).forEach(function (r) {
      var o = (r.execution_outcome && r.execution_outcome.outcome) || {};
      if (o.executor_id !== WNEAR || !okOutcome(o)) return;
      (o.logs || []).forEach(function (l) { var w = l.split(' '); if (w.length === 5 && w[0] === 'Withdraw' && w[2] === 'NEAR') wd[w[4] + '|' + w[1]] = 1; });
    });
    (T.receipts || []).forEach(function (r) {
      var rr = r.receipt || {}, out = (r.execution_outcome && r.execution_outcome.outcome) || {};
      if (!okOutcome(out)) return;
      var pre = rr.predecessor_id || '', to = rr.receiver_id || '';
      var ra = (rr.receipt && rr.receipt.Action && rr.receipt.Action.actions) || [];
      if (pre !== 'system') ra.forEach(function (a) {
        var p = actPair(a), b = p[1];
        if (pre === me && to !== me) {
          if (p[0] === 'Transfer') add('near', -big(b.deposit), to);
          else if (p[0] === 'FunctionCall' && to === WNEAR && b.method_name === 'near_deposit') add('near', -big(b.deposit));
        } else if (to === me && pre !== me && p[0] === 'Transfer' && (sg !== me || pre === WNEAR || wd[pre + '|' + b.deposit])) {
          add('near', big(b.deposit), pre);
        }
      });
      var token = out.executor_id || to;
      (out.logs || []).forEach(function (l) {
        // wrap.near predates NEP-297 events: its transfers log as "Transfer <amount> from <a> to <b>" (seen on
        // RAZA's DARK swap, 2026-11-03, whose wNEAR side was missing from Platform Activity). Read those too.
        // Its wrap and unwrap log too ("Deposit <x> NEAR to <a>", "Withdraw <x> NEAR from <a>"), so a wrap nets out.
        if (token === WNEAR) {
          var lw = l.split(' ');
          if (!/^\d+$/.test(lw[1] || '')) return;
          if (lw.length === 6 && lw[0] === 'Transfer' && lw[2] === 'from' && lw[4] === 'to') {
            if (lw[5] === me && lw[3] !== me) add(token, big(lw[1]), lw[3]);
            else if (lw[3] === me && lw[5] !== me) add(token, -big(lw[1]), lw[5]);
          } else if (lw.length === 5 && lw[0] === 'Deposit' && lw[3] === 'to' && lw[4] === me) add(token, big(lw[1]));
          else if (lw.length === 5 && lw[0] === 'Withdraw' && lw[3] === 'from' && lw[4] === me) add(token, -big(lw[1]));
          if (l.indexOf('EVENT_JSON:') !== 0) return;
        }
        if (l.indexOf('EVENT_JSON:') !== 0) return;
        var ev; try { ev = JSON.parse(l.slice(11)); } catch (e) { return; }
        if (!ev || ev.standard !== 'nep141' || !ev.data) return;
        [].concat(ev.data).forEach(function (d) {
          if (!d) return;
          if (ev.event === 'ft_transfer') {
            if (d.new_owner_id === me && d.old_owner_id !== me) add(token, big(d.amount), d.old_owner_id);
            else if (d.old_owner_id === me && d.new_owner_id !== me) add(token, -big(d.amount), d.new_owner_id);
          } else if (ev.event === 'ft_mint' && d.owner_id === me) add(token, big(d.amount));
          else if (ev.event === 'ft_burn' && d.owner_id === me) add(token, -big(d.amount));
        });
      });
    });
    row.to = Object.keys(peers);
    Object.keys(net).forEach(function (c) {
      var v = net[c];
      if (v === BigInt(0)) return;
      var neg = v < BigInt(0);
      // Under a millionth of a NEAR is dust (the registrar's 1-yoctoNEAR on account creation), not a payment.
      if (c === 'near' && (neg ? -v : v) < BigInt('1000000000000000000')) return;
      legs.push({ ts: ts, h: h, neg: neg, raw: String(neg ? -v : v), c: c, inv: who[c] || '', ok: ok });
    });
  }

  // Symbols, decimals and logos: NEAR and wNEAR known, the curated list next, ft_metadata for the rest under
  // the same 4s cap the holdings use (a token still unanswered shows its contract and no amount).
  function withMeta(legs) {
    var deadline = new Promise(function (res) { setTimeout(function () { res(null); }, 4000); });
    return market().then(function (mk) {
      var byId = {};
      ((mk && mk.rows) || []).forEach(function (row) { if (row && row.i) byId[row.i] = row; });
      var ids = {};
      legs.forEach(function (g) { ids[g.c] = 1; });
      var meta = {};
      return Promise.all(Object.keys(ids).map(function (c) {
        var row = byId[c];
        if (c === 'near') { meta[c] = { s: 'NEAR', d: 24, ic: NEAR_LOGO }; return null; }
        if (c === WNEAR) { meta[c] = { s: 'wNEAR', d: 24, ic: NEAR_LOGO }; return null; }
        if (row && row.dc != null) { meta[c] = { s: cleanSym(row.n) || short(c), d: +row.dc, ic: row.logo || '' }; return null; }
        return Promise.race([tokenMeta(c).then(function (m) { return m && !m.x ? { s: m.s, d: m.d, ic: '' } : null; }, function () { return null; }), deadline])
          .then(function (m) { meta[c] = m || { s: short(c), d: null, ic: '' }; });
      })).then(function () {
        return legs.map(function (g) {
          var m = meta[g.c];
          return { ts: g.ts, h: g.h, neg: g.neg, v: m.d == null ? null : units(g.raw, m.d), c: g.c, s: m.s,
            ic: m.ic, inv: g.inv, cause: '', ok: g.ok };
        });
      });
    });
  }

  // PLATFORM ACTIVITY (RAZA 2026-11-03: "Platform Activity — NEAR" stayed "No platform activity yet." after his
  // swaps). Every NEAR write LumosCore makes pays its fee to the fee account IN THE SAME TRANSACTION -- a swap,
  // a limit order, a bridge -- so that account's transactions are exactly the platform's activity, nothing
  // borrowed from the rest of the chain. Each is decoded from the TRADER's side (the signer), with the same
  // reader the account pages use, and named by the fee transfer's memo.
  var FEE_ACCT = 'fees-lumoscore.near';
  function feeMemo(acts) {
    var memo = '';
    (acts || []).forEach(function (a) {
      var p = actPair(a), b = p[1];
      if (p[0] !== 'FunctionCall' || memo) return;
      try {
        var j = JSON.parse(atob(b.args || ''));
        if (b.method_name === 'ft_transfer' && j && j.receiver_id === FEE_ACCT) memo = String(j.memo || 'fee');
        // THE FEE AS A SWAP (RAZA 2026-11-10, nearswap.js): a token other than NEAR pays its fee by swapping a slice
        // to wNEAR with Rhea delivering it to the collector, so the transaction carries no memo of ours. Its msg does.
        else if (b.method_name === 'ft_transfer_call' && j && JSON.parse(j.msg || '{}').swap_out_recipient === FEE_ACCT) memo = 'LumosCore platform fee';
      } catch (e) {}
    });
    return memo;
  }
  function platformActivity(n) {
    var key = 'lxn.pact';
    try {
      var c = JSON.parse(sessionStorage.getItem(key) || 'null');
      if (c && Date.now() - c.t < 60000 && c.rows) return Promise.resolve(c.rows);
    } catch (e) {}
    return fnPost('account', { account_id: FEE_ACCT }).then(function (j) {
      var list = ((j && j.account_txs) || []).slice(0, n || 15), okBy = {};
      list.forEach(function (x) { okBy[x.transaction_hash] = x.is_success !== false; });
      var hs = list.map(function (x) { return x.transaction_hash; }), calls = [];
      for (var i = 0; i < hs.length; i += 5) calls.push(fnPost('transactions', { tx_hashes: hs.slice(i, i + 5) }).catch(function (e) { return { err: e }; }));
      return Promise.all(calls).then(function (rs) {
        var fails = rs.filter(function (r) { return r && r.err; });
        if (rs.length && fails.length === rs.length) throw fails[0].err;
        var legs = [], rows = [];
        rs.forEach(function (r) {
          ((r && r.transactions) || []).forEach(function (T) {
            var tx = T.transaction || {}, sg = tx.signer_id || '', acts = tx.actions || [];
            if (acts.length === 1 && actPair(acts[0])[0] === 'Delegate') {
              var da = actPair(acts[0])[1].delegate_action || {};
              sg = da.sender_id || sg; acts = da.actions || [];
            }
            var memo = feeMemo(acts);
            if (!memo || okBy[tx.hash] === false) return;            // a failed write moved nothing
            var mine = [];
            decodeTx(sg, T, okBy, [], mine);
            legs = legs.concat(mine);
            rows.push({ h: tx.hash, who: sg, memo: memo, ts: nsMs((T.execution_outcome && T.execution_outcome.block_timestamp) || '') });
          });
        });
        return withMeta(legs).then(function (ft) {
          var by = {};
          ft.forEach(function (f) { (by[f.h] = by[f.h] || []).push(f); });
          rows.forEach(function (r) {
            var g = by[r.h] || [];
            r.give = g.filter(function (f) { return f.neg; })[0] || null;
            r.get = g.filter(function (f) { return !f.neg; }).slice(-1)[0] || null;
          });
          rows.sort(function (a, b) { return b.ts - a.ts; });
          try { sessionStorage.setItem(key, JSON.stringify({ t: Date.now(), rows: rows })); } catch (e) {}
          return rows;
        });
      });
    });
  }

  var ACT_LABEL = {
    ADD_KEY: 'Key added', DELETE_KEY: 'Key removed', CREATE_ACCOUNT: 'Account created',
    DEPLOY_CONTRACT: 'Contract deployed', STAKE: 'Stake', DELETE_ACCOUNT: 'Account deleted'
  };

  function entriesOf(me, d) {
    var out = [], byHash = {};
    d.fts.forEach(function (f) { if (f.h) (byHash[f.h] = byHash[f.h] || []).push(f); });
    Object.keys(byHash).forEach(function (h) {
      var g = byHash[h];
      var outs = g.filter(function (f) { return f.neg; }), ins = g.filter(function (f) { return !f.neg; });
      if (outs.length && ins.length && outs[0].c !== ins[0].c) {
        out.push({ kind: 'swap', ts: g[0].ts, h: h, give: outs[0], get: ins[ins.length - 1], ok: g[0].ok });
        return;
      }
      g.forEach(function (f) { out.push({ kind: f.neg ? 'sent' : 'received', ts: f.ts, h: h, tok: f, other: f.inv, ok: f.ok }); });
    });
    d.txns.forEach(function (t) {
      if (byHash[t.h]) return;
      var dep = 0, onlyTransfer = t.acts.length > 0, call = null, other = '';
      t.acts.forEach(function (a) {
        dep += a.dep || 0;
        if (a.a !== 'TRANSFER') onlyTransfer = false;
        if (a.a === 'FUNCTION_CALL' && !call) call = a.m || 'call';
        if (a.a !== 'TRANSFER' && a.a !== 'FUNCTION_CALL' && !other) other = a.a;
      });
      var near = dep / 1e24;
      if (onlyTransfer) {
        if (t.sg === me && t.rc !== me) out.push({ kind: 'sent', ts: t.ts, h: t.h, near: near, other: t.rc, ok: t.ok });
        else if (t.rc === me && t.sg !== me) out.push({ kind: 'received', ts: t.ts, h: t.h, near: near, other: t.sg, ok: t.ok });
        return;
      }
      if (call) {
        out.push({ kind: 'contract', ts: t.ts, h: t.h, label: 'Contract call', method: call,
          near: t.sg === me ? near : 0, other: t.sg === me ? t.rc : t.sg, mine: t.sg === me, ok: t.ok });
        return;
      }
      out.push({ kind: 'contract', ts: t.ts, h: t.h, label: ACT_LABEL[other] || 'Transaction', other: t.sg === me ? t.rc : t.sg, mine: t.sg === me, ok: t.ok });
    });
    out.sort(function (a, b) { return b.ts - a.ts; });
    return out.slice(0, 25);
  }

  // A NEAR account id by the protocol's rules: 2-64 chars of a-z 0-9, parts joined by single . _ -
  // separators (no leading, trailing or doubled separator); a 64-hex implicit account; or 0x + 40 hex.
  var ACCT_RE = /^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
  function isAccountId(v) {
    v = String(v || '');
    return ACCT_RE.test(v) || /^[0-9a-f]{64}$/.test(v) || /^0x[0-9a-f]{40}$/.test(v);
  }

  // ---- an account's pool positions ----------------------------------------------------------------------
  // Shared by the account page and Pools -> My Pools (moved here from account.js, RAZA 2026-11-04: "Im connected
  // with treasury, so why on pools main page, its not showing my pools").
  // Rhea keeps LP shares per pool (get_pool_shares) with no call that lists an account's pools, so the pools to
  // ask about are FOUND first:
  //   * get_deposits lists every token the account has registered with Rhea. Adding liquidity pulls both sides
  //     from those deposits, so a pool the account is in has ALL its tokens there -- that filter takes ~2,500
  //     pools in Rhea's top list down to a handful (iamempty.near: 11 tokens -> 15 pools, 4 positions).
  //   * the boost farm's list_farmer_seeds names pools whose shares are STAKED (they leave get_pool_shares).
  //   * LumosCore's pool indexer (/who) names every pool the account added liquidity to since 2026-10-29.
  //     Rhea's top list leaves out small new pools -- the treasury's LUMOS/wNEAR 9001 was not in it -- so
  //     these are read from the chain (get_pool) when the list does not have them.
  // Then one get_pool_shares per candidate, at most POOL_CAP of them, largest TVL first. Value and TVL are
  // Rhea's own USD figures (list-top-pools), absent for a pool the list does not carry. DCL (concentrated)
  // positions are not read here.
  var REF = 'v2.ref-finance.near', FARM = 'boostfarm.ref-labs.near';
  var RHEA_POOLS = 'https://indexer.ref.finance/list-top-pools';
  var IDX = 'https://near-pool-indexer.usa282.workers.dev';
  var POOL_CAP = 60;
  function getJson(u) { return fetch(u).then(function (r) { if (!r.ok) throw new Error(u.split('/')[2] + ' ' + r.status); return r.json(); }); }
  function positions(a) {
    return Promise.all([
      getJson(RHEA_POOLS),
      callView(REF, 'get_deposits', { account_id: a }),
      callView(FARM, 'list_farmer_seeds', { farmer_id: a }).catch(function () { return {}; }),
      getJson(IDX + '/who?id=' + encodeURIComponent(a)).catch(function () { return null; })
    ]).then(function (r) {
      var pools = Array.isArray(r[0]) ? r[0] : [], reg = r[1] || {}, seeds = r[2] || {}, ix = r[3];
      var staked = {};
      Object.keys(seeds).forEach(function (k) {
        var m = /^v2\.ref-finance\.near@(\d+)$/.exec(k), s = seeds[k] || {};
        if (m) staked[m[1]] = big(s.free_amount || '0') + big(s.locked_amount || '0');
      });
      var byId = {};
      pools.forEach(function (p) { if (p && /^\d+$/.test(String(p.id))) byId[p.id] = p; });
      var cand = pools.filter(function (p) {
        return p && byId[p.id] === p && Array.isArray(p.token_account_ids) && big(p.shares_total_supply || '0') > BigInt(0)
          && p.token_account_ids.every(function (t) { return Object.prototype.hasOwnProperty.call(reg, t); });
      }).sort(function (x, y) { return (+y.tvl || 0) - (+x.tvl || 0); });
      var capped = cand.length > POOL_CAP;
      cand = cand.slice(0, POOL_CAP);
      var off = [];
      Object.keys(staked).forEach(function (id) { if (byId[id] && cand.indexOf(byId[id]) < 0) cand.push(byId[id]); });
      ((ix && ix.ok && ix.pools) || []).forEach(function (id) {
        id = String(id);
        if (!/^\d{1,7}$/.test(id)) return;
        if (byId[id]) { if (cand.indexOf(byId[id]) < 0) cand.push(byId[id]); } else if (off.indexOf(id) < 0) off.push(id);
      });
      // A pool off Rhea's list, in the list's shape, from the chain. Its symbols come from the tokens' own metadata.
      var offRead = Promise.all(off.slice(0, 20).map(function (id) {
        return callView(REF, 'get_pool', { pool_id: +id }).then(function (p) {
          if (!p || !Array.isArray(p.token_account_ids)) return;
          return Promise.all(p.token_account_ids.map(function (t) { return tokenMeta(t).catch(function () { return null; }); })).then(function (ms) {
            cand.push({ id: id, token_account_ids: p.token_account_ids, amounts: p.amounts, shares_total_supply: p.shares_total_supply,
              token_symbols: ms.map(function (m, k) { return p.token_account_ids[k] === WNEAR ? 'wNEAR' : (m && m.s) || '?'; }), tvl: null });
          });
        }).catch(function () {});
      }));
      var out = [], failed = 0;
      return offRead.then(function () {
        var i = 0;
        function next() {
          if (i >= cand.length) return Promise.resolve();
          var batch = cand.slice(i, i + 6); i += 6;
          return Promise.all(batch.map(function (p) {
            return callView(REF, 'get_pool_shares', { pool_id: +p.id, account_id: a }).then(function (sh) {
              var s = big(sh || '0') + (staked[p.id] || BigInt(0)), total = big(p.shares_total_supply);
              if (s <= BigInt(0) || total <= BigInt(0)) return;
              var f = Number(s * BigInt(1000000000) / total) / 1e9, tvl = p.tvl == null ? NaN : +p.tvl;
              out.push({ id: String(p.id), syms: (p.token_symbols || []).map(function (x) { return String(cleanSym(x) || '?').slice(0, 16); }),
                ids: p.token_account_ids, amounts: p.amounts || [], fraction: f, lp: s.toString(),
                share: f * 100, tvl: isFinite(tvl) ? tvl : null, usd: isFinite(tvl) ? f * tvl : null, farm: !!staked[p.id] });
            }, function () { failed++; });
          })).then(next);
        }
        return next();
      }).then(function () {
        // A pool that could not be asked is not a pool the account is out of: with none found and any unread,
        // the answer is "could not read", never "none".
        if (failed && !out.length) throw new Error('get_pool_shares failed for ' + failed + ' pool(s)');
        out.sort(function (x, y) { return (y.usd == null ? -1 : y.usd) - (x.usd == null ? -1 : x.usd); });
        return { rows: out, capped: capped, failed: failed, cap: POOL_CAP };
      });
    });
  }

  window.lxnCore = {
    RPC: RPC, WNEAR: WNEAR, NEAR_LOGO: NEAR_LOGO, ICONS: ICONS,
    market: market, view: view, callView: callView, units: units, cleanSym: cleanSym,
    ftMetadata: ftMetadata, tokenMeta: tokenMeta, readHoldings: readHoldings, positions: positions,
    activityData: activityData, platformActivity: platformActivity, entriesOf: entriesOf, isAccountId: isAccountId, short: short
  };
})();
