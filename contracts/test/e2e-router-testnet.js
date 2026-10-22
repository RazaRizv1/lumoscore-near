// End-to-end test of the LumosCore swap router on NEAR TESTNET against Ref (ref-finance-101.testnet).
// 2026-10-22 run: 18 passed, 0 failed (router lxrtrmvj79qxu.testnet vs ref-finance-101.testnet 1.9.19, pool 17).
// Throwaway accounts. Creates a router account once (keys/rtr.json), deploys + inits it, registers it, then:
//   A success at 0.2%   B success at 0.1%   C Ref refuses (min_amount_out impossible)   D fee above cap
//   E output wNEAR unwrapped to native NEAR for the user   F the router ends every case holding nothing
const { connect, keyStores, KeyPair, utils } = require('near-api-js');
const fs = require('fs');
process.chdir(__dirname);
const RPC = 'https://test.rpc.fastnear.com';
const WASM = 'C:/LumosCore-NEAR/contracts/router/target/near/lumoscore_router.wasm';
const REF = 'ref-finance-101.testnet', WN = 'wrap.testnet', RF = 'ref.fakes.testnet', POOL = 17;
const Y = (n) => utils.format.parseNearAmount(String(n));
const sleep = (ms) => new Promise((s) => setTimeout(s, ms));
let pass = 0, fail = 0;
const ok = (c, m) => { console.log((c ? '  PASS ' : '  FAIL ') + m); c ? pass++ : fail++; };
const msgOf = (e) => String((e && e.message) || e);

(async () => {
  if (!fs.existsSync('keys/rtr.json')) {
    const id = 'lxrtr' + Date.now().toString(36) + '.testnet', kp = KeyPair.fromRandom('ed25519');
    const r = await fetch('https://helper.testnet.near.org/account', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ newAccountId: id, newAccountPublicKey: kp.getPublicKey().toString() }) });
    if (!r.ok) throw new Error('router account: ' + r.status + ' ' + (await r.text()).slice(0, 200));
    fs.writeFileSync('keys/rtr.json', JSON.stringify({ id, sk: kp.toString() }));
    await sleep(3000);
  }
  const k = (r) => JSON.parse(fs.readFileSync('keys/' + r + '.json', 'utf8'));
  const ks = new keyStores.InMemoryKeyStore();
  for (const r of ['rtr', 'user', 'fees']) { const a = k(r); await ks.setKey('testnet', a.id, KeyPair.fromString(a.sk)); }
  const near = await connect({ networkId: 'testnet', keyStore: ks, nodeUrl: RPC });
  const rtr = await near.account(k('rtr').id), user = await near.account(k('user').id), fees = await near.account(k('fees').id);
  const prov = near.connection.provider;
  const view = (c, m, a) => user.viewFunction({ contractId: c, methodName: m, args: a || {} });
  const bal = async (t, a) => BigInt(await view(t, 'ft_balance_of', { account_id: a }));
  const nearBal = async (a) => BigInt((await prov.query({ request_type: 'view_account', finality: 'final', account_id: a })).amount);
  const reg = async (acct, token, payer) => {
    if (await view(token, 'storage_balance_of', { account_id: acct })) return;
    const b = await view(token, 'storage_balance_bounds');
    await (payer || user).functionCall({ contractId: token, methodName: 'storage_deposit', args: { account_id: acct, registration_only: true }, gas: '30000000000000', attachedDeposit: b.min });
  };

  // deploy + init (once)
  const acct = await prov.query({ request_type: 'view_account', finality: 'final', account_id: rtr.accountId });
  if (acct.code_hash === '11111111111111111111111111111111') {
    await rtr.deployContract(fs.readFileSync(WASM));
    await rtr.functionCall({ contractId: rtr.accountId, methodName: 'new', args: { owner_id: rtr.accountId, fee_account: fees.accountId, rhea: REF, max_fee_bps: 20 }, gas: '30000000000000' });
  } else {
    await rtr.deployContract(fs.readFileSync(WASM));   // keep the testnet router on the current build
  }
  const cfg = await view(rtr.accountId, 'get_config');
  ok(cfg.rhea === REF && cfg.fee_account === fees.accountId && cfg.max_fee_bps === 20, 'router initialised: ' + rtr.accountId);

  // registrations: router on both tokens (through its own owner method), user + fees where needed
  for (const t of [WN, RF]) {
    if (!(await view(t, 'storage_balance_of', { account_id: rtr.accountId }))) {
      const b = await view(t, 'storage_balance_bounds');
      await rtr.functionCall({ contractId: rtr.accountId, methodName: 'register_token', args: { token: t }, gas: '50000000000000', attachedDeposit: b.min });
    }
  }
  ok(!!(await view(WN, 'storage_balance_of', { account_id: rtr.accountId })) && !!(await view(RF, 'storage_balance_of', { account_id: rtr.accountId })), 'router registered on both tokens via register_token');
  await reg(user.accountId, WN); await reg(user.accountId, RF); await reg(fees.accountId, WN); await reg(fees.accountId, RF);
  await user.functionCall({ contractId: WN, methodName: 'near_deposit', args: {}, gas: '10000000000000', attachedDeposit: Y(0.5) });
  await sleep(4000);   // 'final' reads lag a couple of blocks

  const swap = (token, amount, msg) => user.functionCall({ contractId: token, methodName: 'ft_transfer_call',
    args: { receiver_id: rtr.accountId, amount, msg: JSON.stringify(msg) }, gas: '300000000000000', attachedDeposit: '1' });
  const act = (inT, outT, min) => [{ pool_id: POOL, token_in: inT, token_out: outT, min_amount_out: min }];
  const snap = async () => ({ uW: await bal(WN, user.accountId), uR: await bal(RF, user.accountId), fW: await bal(WN, fees.accountId), fR: await bal(RF, fees.accountId), rW: await bal(WN, rtr.accountId), rR: await bal(RF, rtr.accountId) });

  // A: success at 0.2%
  const amt = BigInt(Y(0.1));
  let s0 = await snap();
  let r = await swap(WN, amt.toString(), { fee_bps: 20, actions: act(WN, RF, '1') });
  await sleep(4000);
  let s1 = await snap();
  const feeA = amt * 20n / 10000n;
  ok(s0.uW - s1.uW === amt, 'A: user spent exactly the 0.1 wNEAR (spent ' + (s0.uW - s1.uW) + ')');
  ok(s1.uR > s0.uR, 'A: output delivered straight to the user: ' + (s1.uR - s0.uR));
  ok(s1.fW - s0.fW === feeA, 'A: fee account got exactly 0.2% = ' + feeA);
  ok(s1.rW === s0.rW && s1.rR === s0.rR, 'A: router holds nothing after the swap');
  ok(r.receipts_outcome.flatMap((o) => o.outcome.logs).some((l) => l.includes('"event":"swap"')), 'A: swap event logged');

  // B: success at 0.1%
  s0 = await snap();
  await swap(WN, amt.toString(), { fee_bps: 10, actions: act(WN, RF, '1') });
  await sleep(4000);
  s1 = await snap();
  ok(s1.fW - s0.fW === amt * 10n / 10000n, 'B: fee account got exactly 0.1%');
  ok(s1.uR > s0.uR && s1.rW === s0.rW, 'B: output delivered, router holds nothing');

  // C: Ref refuses (impossible minimum) -> everything back, no fee
  s0 = await snap();
  r = await swap(WN, amt.toString(), { fee_bps: 20, actions: act(WN, RF, '1' + '0'.repeat(40)) });
  await sleep(5000);
  s1 = await snap();
  ok(s1.uW === s0.uW, 'C: refused swap returned the whole 0.1 wNEAR, fee included (user wNEAR unchanged)');
  ok(s1.fW === s0.fW, 'C: fee account received nothing');
  ok(s1.uR === s0.uR, 'C: no output');
  ok(s1.rW === s0.rW && s1.rR === s0.rR, 'C: router holds nothing');
  ok(r.receipts_outcome.flatMap((o) => o.outcome.logs).some((l) => l.includes('swap_refunded')), 'C: swap_refunded event logged');

  // D: fee above the cap -> ft_on_transfer panics, the token returns everything
  s0 = await snap();
  try { await swap(WN, amt.toString(), { fee_bps: 21, actions: act(WN, RF, '1') }); } catch (e) { /* the outer call may report the receiver's panic */ }
  await sleep(4000);
  s1 = await snap();
  ok(s1.uW === s0.uW && s1.fW === s0.fW && s1.rW === s0.rW, 'D: fee above cap refused, nothing moved');

  // E: output is wNEAR, not skipped -> Ref unwraps to native NEAR for the user
  const rIn = (s1.uR / 4n).toString();
  const n0 = await nearBal(user.accountId); const w0 = await bal(WN, user.accountId); const fr0 = await bal(RF, fees.accountId);
  r = await swap(RF, rIn, { fee_bps: 20, actions: act(RF, WN, '1') });
  await sleep(5000);
  const n1 = await nearBal(user.accountId); const w1 = await bal(WN, user.accountId); const fr1 = await bal(RF, fees.accountId);
  const logs = r.receipts_outcome.flatMap((o) => o.outcome.logs);
  logs.filter((l) => /Swapped|unwrap|Withdraw|near_withdraw|Transfer/i.test(l)).forEach((l) => console.log('    log', l.slice(0, 160)));
  console.log('    native NEAR change (incl. gas):', utils.format.formatNearAmount((n1 - n0).toString()), ' wNEAR change:', (w1 - w0).toString());
  ok(n1 > n0 && w1 === w0, 'E: output arrived as native NEAR, not wNEAR');
  ok(fr1 - fr0 === BigInt(rIn) * 20n / 10000n, 'E: fee taken in the input token (ref.fakes)');
  ok((await bal(WN, rtr.accountId)) === s1.rW && (await bal(RF, rtr.accountId)) === s1.rR, 'E/F: router still holds nothing');

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
})().catch((e) => { console.error('ERROR', msgOf(e).slice(0, 700)); process.exit(1); });
