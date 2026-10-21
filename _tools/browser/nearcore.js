// NEAR reads shared by the Wallet page, the Account page and the header search: FastNEAR RPC (view_account,
// ft_metadata), FastNEAR's token-balance index, /lxapi/nearmarket, and NearBlocks activity.
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
    return Promise.all([nbGet(me, '/txns-only?per_page=25'), nbGet(me, '/ft-txns?per_page=25')]).then(function (r) {
      var d = { t: Date.now(), txns: ((r[0] && r[0].txns) || []).map(normTx), fts: ((r[1] && r[1].txns) || []).map(normFt) };
      try { sessionStorage.setItem(key, JSON.stringify(d)); } catch (e) {}
      return d;
    }, function (e) {
      if (e && e.code === 429) { try { sessionStorage.setItem('lxn.act.hold', String(Date.now() + 60000)); } catch (x) {} }
      throw e;
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

  window.lxnCore = {
    RPC: RPC, WNEAR: WNEAR, NEAR_LOGO: NEAR_LOGO, ICONS: ICONS,
    market: market, view: view, callView: callView, units: units, cleanSym: cleanSym,
    ftMetadata: ftMetadata, tokenMeta: tokenMeta, readHoldings: readHoldings,
    activityData: activityData, entriesOf: entriesOf, isAccountId: isAccountId, short: short
  };
})();
