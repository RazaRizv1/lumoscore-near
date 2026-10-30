// Bridge page: the OMNI BRIDGE and WORMHOLE routes out of NEAR, beside NEAR Intents (RAZA 2026-10-30:
// "why only near intents as cross chain bridge on Near. I need 2 more").
//
// window.lxnBr is the engine; nibridge.js owns the page and asks it three things per route: can this
// asset reach that chain (from the table _tools/_nearbridgeroutes.js bakes in), what will it cost, and
// which transactions carry it. Injected after nearswap.js and before nibridge.js.
//
// WHAT EACH ROUTE IS, and why the page has to say so:
//   * NEAR INTENTS swaps into the destination chain's own asset (ETH, USDC...). Unchanged.
//   * OMNI BRIDGE (omni.bridge.near, Near One) carries THE SAME TOKEN: wNEAR leaves as Omni's NEAR on
//     Ethereum, SWEAT as Omni's SWEAT. Relayers finish the transfer on the other side, paid by a fee in
//     NEAR that rides with it, so there is nothing to claim. The fee comes from Omni's own API.
//   * WORMHOLE (contract.portalbridge.near) carries the same token as Wormhole's wrapped copy. NOBODY
//     RELAYS NEAR TRANSFERS ANY MORE, so the reader claims it on the destination with an EVM wallet once
//     the guardians have signed (~15 minutes) -- the same shape as Stellar's CCTP claim, whose EVM
//     wallet code (EIP-6963 picker, chain switch, simulate-then-send) is ported below.
//
// THE FEE IS THE SAME 0.2% IN THE INPUT TOKEN to fees-lumoscore.near, marker on the memo: lx:om, lx:wh.
//
// NOTHING HERE FABRICATES A NUMBER. What arrives is the amount sent less LumosCore's fee, floored to what
// the bridge can carry (Wormhole carries 8 decimals; Omni normalises to the destination's decimals), and
// the bridge's own fee is shown as the bridge quoted it.
(function () {
  if (window.lxnBr) return;

  var BR = __LX_BR_ROUTES__;
  var OMNI = 'omni.bridge.near';
  var OMNI_API = 'https://mainnet.api.bridge.nearone.org';
  var PORTAL = 'contract.portalbridge.near';
  var WHSCAN = 'https://api.wormholescan.io/api/v1/operations?txHash=';
  var WNEAR = 'wrap.near';
  var TGAS = '000000000000';
  var ZERO = BigInt(0);
  // GAS THE WALLET RESERVES, kept back from a NEAR balance (near-wallet-error-is-not-a-verdict: HOT says
  // "User rejected the request" when it cannot cover the pessimistic reserve). Omni's transfer carries
  // 300 TGas, Wormhole's 200; the swap's 0.2 NEAR covers 180.
  var KEEP = { om: '350000000000000000000000', wh: '250000000000000000000000' };
  // Omni names chains by a short prefix on the recipient ("eth:0x…").
  var OM_PREFIX = { Ethereum: 'eth', Base: 'base', Arbitrum: 'arb', Solana: 'sol', 'BNB Chain': 'bnb', Polygon: 'pol' };
  // An address of the right SHAPE for a fee quote asked before the reader has typed theirs; the fee does
  // not depend on who receives it, only on where.
  var OM_ANYONE = { sol: '11111111111111111111111111111111' };
  var EVM_ANYONE = '0x000000000000000000000000000000000000dEaD';

  function S() { return window.lxnSwap; }
  function big(s) { return BigInt(String(s == null ? '0' : s)); }
  function pow10(n) { var x = BigInt(1); for (var i = 0; i < n; i++) x = x * BigInt(10); return x; }
  function fn(methodName, args, tgas, deposit) {
    return { type: 'FunctionCall', params: { methodName: methodName, args: args, gas: String(tgas) + TGAS, deposit: String(deposit) } };
  }

  // ---- what can go where ---------------------------------------------------------------------------
  // Native NEAR goes over Omni as wNEAR (wrapped in the same transaction) and over Wormhole natively
  // (send_transfer_near), which is the asset Wormhole has attested on six chains; wNEAR on only two.
  function omKey(src) { return src.native ? WNEAR : src.contract; }
  function whKey(src) { return src.native ? 'near' : src.contract; }
  function omTo(src, label) { var t = src && BR.om[omKey(src)]; return (t && t[label]) || null; }
  function whTo(src, label) { var t = src && BR.wh[whKey(src)]; return (t && t[label]) || null; }
  function can(route, src, label) { return !!(route === 'om' ? omTo(src, label) : route === 'wh' ? whTo(src, label) : null); }
  function places() {
    var o = {};
    [BR.om, BR.wh].forEach(function (m) {
      Object.keys(m).forEach(function (k) { Object.keys(m[k]).forEach(function (l) { o[l] = 1; }); });
    });
    return Object.keys(o);
  }
  // Curated tokens one of the two can carry that NEAR Intents does not take, as source rows.
  function extraSources(have) {
    var out = [];
    Object.keys(BR.meta).forEach(function (id) {
      var m = BR.meta[id];
      if (m.native || have[id]) return;
      out.push({ id: id, native: false, symbol: m.s, name: m.n || '', decimals: m.d, contract: id,
        assetId: '', price: null, logo: m.logo || '', brOnly: true });
    });
    return out;
  }

  // ---- amounts -------------------------------------------------------------------------------------
  // WHAT THE BRIDGE CAN CARRY, floored. Wormhole truncates to 8 decimals and KEEPS the remainder of a
  // token transfer (its ft_on_transfer returns 0, so nothing is refunded); Omni normalises to the
  // destination's decimals. So the page sends the carried figure exactly and the dust stays in the wallet.
  function carried(route, src, label, net) {
    var n = big(net), m = BigInt(1);
    if (route === 'wh') { if (src.decimals > 8) m = pow10(src.decimals - 8); }
    else if (route === 'om') {
      var t = omTo(src, label);
      if (t && t.odec > t.dec) m = pow10(t.odec - t.dec);
    }
    return (n - n % m).toString();
  }

  // ---- addresses -----------------------------------------------------------------------------------
  function isEvm(label) { return !!BR.wh_chain[label] || (OM_PREFIX[label] && label !== 'Solana'); }
  function addrOk(label, a) {
    a = String(a || '').trim();
    if (label === 'Solana') return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a);
    return /^0x[0-9a-fA-F]{40}$/.test(a);
  }

  // ---- OMNI ----------------------------------------------------------------------------------------
  // The fee Omni's relayers want, in NEAR, from Omni's own API (CORS open, so each reader spends their
  // own allowance). Resolves { nativeFee, usd, min } or rejects with a sentence.
  function omQuote(src, label, net, me, to) {
    var p = OM_PREFIX[label];
    if (!p) return Promise.reject(new Error('Omni Bridge does not reach ' + label + '.'));
    var who = (to && addrOk(label, to)) ? to : (OM_ANYONE[p] || EVM_ANYONE);
    var u = OMNI_API + '/api/v3/transfer-fee?sender=' + encodeURIComponent('near:' + (me || PORTAL))
      + '&recipient=' + encodeURIComponent(p + ':' + who)
      + '&token=' + encodeURIComponent('near:' + omKey(src)) + '&amount=' + encodeURIComponent(net);
    return fetch(u).then(function (r) {
      return r.text().then(function (t) {
        if (!r.ok) throw new Error(/^[\x20-\x7e]{1,140}$/.test(t) ? ('Omni Bridge: ' + t) : 'Omni Bridge is not answering right now — try again shortly.');
        var j = JSON.parse(t);
        if (!j || j.native_token_fee == null || !/^[0-9]+$/.test(String(j.native_token_fee))) throw new Error('Omni Bridge did not quote a fee.');
        return { nativeFee: String(j.native_token_fee), usd: Number(j.usd_fee), min: j.min_amount ? String(j.min_amount) : '' };
      });
    }, function () { throw new Error('Omni Bridge is not answering right now — try again shortly.'); });
  }

  // What the account still needs in Omni's storage: the account and init-transfer requirements less what
  // it already holds there, plus the relayer fee, which is paid OUT of that storage balance.
  function omStorage(me, nativeFee) {
    return Promise.all([
      S().callView(OMNI, 'required_balance_for_account', {}),
      S().callView(OMNI, 'required_balance_for_init_transfer', {}),
      S().callView(OMNI, 'storage_balance_of', { account_id: me })
    ]).then(function (r) {
      if (!/^[0-9]+$/.test(String(r[0])) || !/^[0-9]+$/.test(String(r[1]))) throw new Error('Omni Bridge did not say what its storage costs.');
      var need = big(r[0]) + big(r[1]);
      var have = (r[2] && r[2].available != null) ? big(r[2].available) : ZERO;
      var add = need > have ? need - have : ZERO;
      return (add + big(nativeFee)).toString();
    });
  }

  function storageOf(contract, account) { return S().callView(contract, 'storage_balance_of', { account_id: account }); }
  function storageMin(contract) {
    return S().callView(contract, 'storage_balance_bounds', {}).then(function (b) {
      var m = b && b.min != null ? String(b.min) : '';
      if (!/^[0-9]+$/.test(m)) throw new Error('This token did not say what registering costs.');
      return m;
    });
  }

  // TWO TRANSACTIONS. The storage top-up (which carries the relayer fee) goes to omni.bridge.near, and the
  // transfer goes to the token -- a transaction has one receiver. The token one is atomic in itself: wrap,
  // registration, LumosCore's fee and the bridge transfer in one receipt. If the second never runs, the
  // first is still the reader's: Omni keeps it as their storage balance, used by their next transfer.
  //   tx 1  omni.bridge.near  storage_deposit()                                     10 TGas, top-up + relayer fee
  //   tx 2  token             [native] storage_deposit(me) on wrap.near, near_deposit(fee + carried)
  //                           [if needed] storage_deposit(omni.bridge.near) on the token
  //                           ft_transfer(fees-lumoscore.near, fee, "lx:om")         30 TGas, 1 yocto
  //                           ft_transfer_call(omni.bridge.near, carried, msg)      300 TGas, 1 yocto
  function omBuild(me, src, label, amt, to, nativeFee) {
    var c = omKey(src), dest = OM_PREFIX[label];
    return Promise.all([
      omStorage(me, nativeFee),
      storageOf(c, OMNI),
      src.native ? storageOf(WNEAR, me) : Promise.resolve(true)
    ]).then(function (r) {
      var needBridge = !r[1], needMe = !r[2];
      return ((needBridge || needMe) ? storageMin(c) : Promise.resolve(null)).then(function (min) {
        var txs = [];
        if (big(r[0]) > ZERO) txs.push({ signerId: me, receiverId: OMNI, actions: [fn('storage_deposit', {}, 10, r[0])] });
        var acts = [];
        if (src.native) {
          if (needMe) acts.push(fn('storage_deposit', { account_id: me, registration_only: true }, 10, min));
          acts.push(fn('near_deposit', {}, 10, (big(amt.fee) + big(amt.carried)).toString()));
        }
        if (needBridge) acts.push(fn('storage_deposit', { account_id: OMNI, registration_only: true }, 10, min));
        if (big(amt.fee) > ZERO) acts.push(fn('ft_transfer', { receiver_id: S().feeAccount(), amount: amt.fee, memo: 'lx:om' }, 30, '1'));
        acts.push(fn('ft_transfer_call', { receiver_id: OMNI, amount: amt.carried, memo: null,
          msg: JSON.stringify({ recipient: dest + ':' + to, fee: '0', native_token_fee: String(nativeFee), msg: null }) }, 300, '1'));
        txs.push({ signerId: me, receiverId: c, actions: acts });
        var nearOut = big(r[0]) + (src.native ? big(amt.fee) + big(amt.carried) : ZERO)
          + (needMe && min ? big(min) : ZERO) + (needBridge && min ? big(min) : ZERO);
        return { txs: txs, main: c, nearOut: nearOut.toString() };
      });
    });
  }

  // Omni's own record of a transfer, by the NEAR transaction that started it.
  //   Initialised -> Signed -> (Fast)Finalised on the destination -> Settled.
  function omStatus(hash) {
    return fetch(OMNI_API + '/api/v4/transfers/transfer/status?transaction_hash=' + encodeURIComponent(hash))
      .then(function (r) { if (r.status === 404) return []; if (!r.ok) throw new Error('omni ' + r.status); return r.json(); })
      .then(function (j) {
        var st = Array.isArray(j) ? j : ((j && j.statuses) || []);
        var last = st.length ? String(st[st.length - 1]) : '';
        if (/^(Finalised|FastFinalised|Settled|Claimed)$/.test(last) || st.indexOf('Finalised') >= 0 || st.indexOf('Settled') >= 0) return 'SUCCESS';
        if (/Failed|Refund/i.test(last)) return 'FAILED';
        return st.length ? 'PROCESSING' : 'PENDING';
      });
  }

  // ---- WORMHOLE ------------------------------------------------------------------------------------
  //   native NEAR:  tx 1  contract.portalbridge.near  send_transfer_near(receiver, chain, …)  150 TGas, carried
  //                 tx 2  wrap.near  [storage_deposit(me)], near_deposit(fee), ft_transfer(fees, fee, "lx:wh")
  //     The bridge goes FIRST and the fee after it, because the two cannot share a receipt: if anything
  //     stops between them it is LumosCore's fee that goes unpaid, never the reader charged for nothing.
  //   a token:      one tx to the token  [storage_deposit(portal)], ft_transfer(fees, fee, "lx:wh"),
  //                 ft_transfer_call(portal, carried, TransferMsgPayload)                 200 TGas, 1 yocto
  // The core's message fee is 0 on NEAR (contract.wormhole_crypto.near message_fee, read 2026-10-30), so
  // no "bank" is needed; a non-zero one would be refused by the portal, not charged silently.
  function whMsg(label, to) {
    var c = BR.wh_chain[label];
    return { receiver: String(to).replace(/^0x/i, '').toLowerCase(), chain: c.id, fee: '0', payload: '', message_fee: 0 };
  }
  function whBuild(me, src, label, amt, to) {
    var m = whMsg(label, to);
    if (src.native) {
      return storageOf(WNEAR, me).then(function (reg) {
        return (reg ? Promise.resolve(null) : storageMin(WNEAR)).then(function (min) {
          var txs = [{ signerId: me, receiverId: PORTAL, actions: [fn('send_transfer_near', m, 150, amt.carried)] }];
          if (big(amt.fee) > ZERO) {
            var acts = [];
            if (!reg) acts.push(fn('storage_deposit', { account_id: me, registration_only: true }, 10, min));
            acts.push(fn('near_deposit', {}, 10, amt.fee));
            acts.push(fn('ft_transfer', { receiver_id: S().feeAccount(), amount: amt.fee, memo: 'lx:wh' }, 30, '1'));
            txs.push({ signerId: me, receiverId: WNEAR, actions: acts });
          }
          var nearOut = big(amt.carried) + big(amt.fee) + (min ? big(min) : ZERO);
          return { txs: txs, main: PORTAL, nearOut: nearOut.toString() };
        });
      });
    }
    var c = src.contract;
    return storageOf(c, PORTAL).then(function (reg) {
      return (reg ? Promise.resolve(null) : storageMin(c)).then(function (min) {
        var acts = [];
        if (!reg) acts.push(fn('storage_deposit', { account_id: PORTAL, registration_only: true }, 10, min));
        if (big(amt.fee) > ZERO) acts.push(fn('ft_transfer', { receiver_id: S().feeAccount(), amount: amt.fee, memo: 'lx:wh' }, 30, '1'));
        acts.push(fn('ft_transfer_call', { receiver_id: PORTAL, amount: amt.carried, msg: JSON.stringify(m) }, 200, '1'));
        return { txs: [{ signerId: me, receiverId: c, actions: acts }], main: c, nearOut: (min ? big(min) : ZERO).toString() };
      });
    });
  }

  // Wormholescan, by the NEAR transaction: nothing yet (the guardians have not signed), a signed message
  // (ready to claim), or the destination's redeem (delivered). CORS open.
  function whStatus(hash) {
    return fetch(WHSCAN + encodeURIComponent(hash)).then(function (r) {
      if (!r.ok) throw new Error('wormholescan ' + r.status);
      return r.json();
    }).then(function (j) {
      var op = j && j.operations && j.operations[0];
      if (!op) return { status: 'PENDING' };
      var tc = op.targetChain;
      if (tc && /completed|confirmed/i.test(String(tc.status || '')) && tc.transaction && tc.transaction.txHash) {
        return { status: 'SUCCESS', claimTx: tc.transaction.txHash, vaa: op.vaa && op.vaa.raw };
      }
      if (op.vaa && op.vaa.raw) return { status: 'READY', vaa: op.vaa.raw, id: op.id };
      return { status: 'PENDING' };
    });
  }

  // ---- the EVM side of a Wormhole claim (ported from Stellar's _cctp.js) -----------------------------
  // WHICH EVM WALLET, WHEN MORE THAN ONE IS INSTALLED: window.ethereum is one slot every injected wallet
  // races for, so with two installed the winner is whichever loaded last. EIP-6963 lets each announce
  // itself; the page lists them, and window.ethereum is only the fallback. Chain-locked wallets (HashPack
  // and friends speak EIP-1193 for Hedera only) are left off a list for any other chain.
  var EVM = {
    Ethereum: { id: '0x1', n: 'Ethereum', cur: 'ETH', rpc: 'https://ethereum-rpc.publicnode.com', exp: 'https://etherscan.io' },
    'BNB Chain': { id: '0x38', n: 'BNB Chain', cur: 'BNB', rpc: 'https://bsc-dataseed.bnbchain.org', exp: 'https://bscscan.com' },
    Polygon: { id: '0x89', n: 'Polygon', cur: 'POL', rpc: 'https://polygon-rpc.com', exp: 'https://polygonscan.com' },
    Avalanche: { id: '0xa86a', n: 'Avalanche', cur: 'AVAX', rpc: 'https://api.avax.network/ext/bc/C/rpc', exp: 'https://snowtrace.io' },
    Arbitrum: { id: '0xa4b1', n: 'Arbitrum', cur: 'ETH', rpc: 'https://arb1.arbitrum.io/rpc', exp: 'https://arbiscan.io' },
    Optimism: { id: '0xa', n: 'Optimism', cur: 'ETH', rpc: 'https://mainnet.optimism.io', exp: 'https://optimistic.etherscan.io' },
    Base: { id: '0x2105', n: 'Base', cur: 'ETH', rpc: 'https://mainnet.base.org', exp: 'https://basescan.org' }
  };
  var PROVS = [], PICK = null;
  try {
    window.addEventListener('eip6963:announceProvider', function (ev) {
      var d = ev && ev.detail;
      if (!d || !d.provider || !d.info) return;
      for (var i = 0; i < PROVS.length; i++) if (PROVS[i].info.uuid === d.info.uuid) return;
      PROVS.push(d);
    });
    window.dispatchEvent(new Event('eip6963:requestProvider'));
  } catch (_) {}
  var LOCKED = [{ m: /hashpack|kabila|blade/i, ids: ['0x127', '0x128', '0x129'] }];
  function serves(d, chainId) {
    var s = ((d && d.info && d.info.name) || '') + ' ' + ((d && d.info && d.info.rdns) || '');
    for (var i = 0; i < LOCKED.length; i++) if (LOCKED[i].m.test(s)) return LOCKED[i].ids.indexOf(String(chainId).toLowerCase()) >= 0;
    return true;
  }
  function prov() {
    if (PICK && PICK.provider) return PICK.provider;
    if (PROVS.length === 1) return PROVS[0].provider;
    return window.ethereum || null;
  }
  function phone() {
    try {
      if (/Android|iPhone|iPad|iPod|Windows Phone|Mobile Safari/i.test(navigator.userAgent || '')) return true;
      return window.matchMedia('(pointer:coarse)').matches && !window.matchMedia('(hover:hover)').matches;
    } catch (_) { return false; }
  }
  function req(m, p) {
    var e = prov();
    if (!e) {
      return Promise.reject(new Error(phone()
        ? 'No wallet browser here. On a phone, claim inside your wallet app’s own browser (MetaMask, Rabby, Coinbase Wallet) — this transfer is listed in THIS browser, so open the bridge page there and paste the NEAR transaction hash into a Wormhole explorer, or claim from a desktop.'
        : 'No EVM wallet detected — install MetaMask or Rabby to claim on the destination chain.'));
    }
    return e.request({ method: m, params: p || [] });
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function pickWallet(cfg) {
    var list = PROVS.filter(function (d) { return serves(d, cfg.id); });
    if (!list.length) list = PROVS;
    if (!PICK && list.length === 1) { PICK = list[0]; return Promise.resolve(); }
    if (PICK || list.length < 2) return Promise.resolve();
    return new Promise(function (resolve) {
      var ov = document.createElement('div');
      ov.className = 'lx-evmpick';
      ov.style.cssText = 'position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.55)';
      var rows = list.map(function (p, i) {
        return '<button type="button" data-i="' + i + '" style="display:flex;align-items:center;gap:10px;width:100%;padding:11px 13px;margin:6px 0;'
          + 'background:var(--surface-2,rgba(127,127,140,.10));border:1px solid var(--border,#2a2a35);border-radius:10px;color:inherit;font:inherit;cursor:pointer;text-align:left">'
          + (p.info.icon ? '<img src="' + esc(p.info.icon) + '" alt="" style="width:22px;height:22px;border-radius:6px">' : '')
          + '<span style="font-weight:700">' + esc(p.info.name || 'Wallet') + '</span></button>';
      }).join('');
      ov.innerHTML = '<div style="max-width:330px;width:calc(100% - 40px);background:var(--surface,#14141b);border:1px solid var(--border,#2a2a35);'
        + 'border-radius:14px;padding:18px 16px"><div style="font-weight:800;margin-bottom:4px">Choose a wallet</div>'
        + '<div style="font-size:12.5px;color:var(--text-soft,#8a8fa3);margin-bottom:10px">Claim on ' + esc(cfg.n) + ' with:</div>' + rows + '</div>';
      ov.addEventListener('click', function (e) {
        var b = e.target && e.target.closest ? e.target.closest('button[data-i]') : null;
        if (b) { PICK = list[+b.getAttribute('data-i')] || null; try { ov.remove(); } catch (_) {} resolve(); return; }
        if (e.target === ov) { try { ov.remove(); } catch (_) {} resolve(); }
      });
      document.body.appendChild(ov);
    });
  }
  function hex32(n) { var h = (+n).toString(16); while (h.length < 64) h = '0' + h; return h; }
  function b64hex(b64) {
    var bin = atob(String(b64 || '')), h = '';
    for (var i = 0; i < bin.length; i++) h += ('0' + bin.charCodeAt(i).toString(16)).slice(-2);
    return h;
  }
  // completeTransfer(bytes encodedVm), selector c6878519 (keccak256, computed offline and checked
  // against transfer(address,uint256) = a9059cbb with the same code).
  function completeData(vaaB64) {
    var h = b64hex(vaaB64), len = h.length / 2, pad = (64 - (h.length % 64)) % 64, z = '';
    while (z.length < pad) z += '0';
    return '0xc6878519' + hex32(32) + hex32(len) + h + z;
  }
  function waitReceipt(hash) {
    var n = 0;
    function poll() {
      return req('eth_getTransactionReceipt', [hash]).then(function (r) {
        if (r && r.blockNumber) return (r.status === '0x1' || r.status === 1);
        if (++n > 90) return null;                 // stop WAITING; an unknown result is never called success
        return new Promise(function (go) { setTimeout(go, 2000); }).then(poll);
      });
    }
    return poll();
  }
  // Simulate first: an already-claimed or malformed message fails here, free, before the wallet opens.
  function whClaim(label, vaa, onStatus) {
    var cfg = EVM[label], tb = BR.wh_chain[label] && BR.wh_chain[label].tb;
    if (!cfg || !tb) return Promise.reject(new Error('Claiming is not wired for ' + label + '.'));
    if (!vaa) return Promise.reject(new Error('Wormhole has not signed this transfer yet.'));
    var data = completeData(vaa), from = null;
    onStatus('Connecting your EVM wallet…');
    return pickWallet(cfg).then(function () { return req('eth_requestAccounts'); }).then(function (a) {
      if (!a || !a.length) throw new Error('No account authorised in your EVM wallet.');
      from = a[0];
      onStatus('Switching to ' + cfg.n + '…');
      return req('wallet_switchEthereumChain', [{ chainId: cfg.id }]).catch(function (e) {
        if (e && (e.code === 4902 || /unrecogni|not added|add this network/i.test(e.message || ''))) {
          return req('wallet_addEthereumChain', [{ chainId: cfg.id, chainName: cfg.n,
            nativeCurrency: { name: cfg.cur, symbol: cfg.cur, decimals: 18 }, rpcUrls: [cfg.rpc], blockExplorerUrls: [cfg.exp] }]);
        }
        throw e;
      });
    }).then(function () {
      onStatus('Checking the claim will succeed…');
      return req('eth_call', [{ from: from, to: tb, data: data }, 'latest']).catch(function (e) {
        var m = String((e && (e.message || (e.data && e.data.message))) || '');
        if (/already redeemed|transfer already completed/i.test(m)) throw new Error('Already claimed — it is in the receiving wallet.');
        throw new Error('The claim would fail on ' + cfg.n + (m ? ': ' + m.slice(0, 120) : '.'));
      });
    }).then(function () {
      onStatus('Confirm the claim in your wallet…');
      return req('eth_sendTransaction', [{ from: from, to: tb, data: data }]);
    }).then(function (hash) {
      onStatus('Waiting for ' + cfg.n + ' to confirm…');
      return waitReceipt(hash).then(function (ok) { return { hash: hash, ok: ok, exp: cfg.exp + '/tx/' + hash }; });
    });
  }

  window.lxnBr = {
    can: can, omTo: omTo, whTo: whTo, places: places, extraSources: extraSources, carried: carried,
    addrOk: addrOk, isEvm: isEvm, KEEP: KEEP,
    omQuote: omQuote, omBuild: omBuild, omStatus: omStatus,
    whBuild: whBuild, whStatus: whStatus, whClaim: whClaim, evmExplorer: function (l) { return EVM[l] ? EVM[l].exp : ''; }
  };
})();
