// End-to-end test of the LumosCore factory on NEAR TESTNET (throwaway accounts, free test NEAR).
// Run from contracts/test after `npm i near-api-js@5` and `node mkacct-testnet.js` (keys land in ./keys, gitignored).
// 2026-10-21 run: 19 passed, 0 failed; launch burnt 35 TGas; storage 1.665 NEAR for 164,837 bytes locked.
const { connect, keyStores, KeyPair, utils } = require('near-api-js');
const fs = require('fs');
process.chdir(__dirname);
const RPC = 'https://test.rpc.fastnear.com';
const WASM = 'C:/LumosCore-NEAR/contracts/factory/target/near/lumoscore_factory.wasm';
const Y = (n) => utils.format.parseNearAmount(String(n));
const N = (y) => (Number(BigInt(y) / 10n ** 18n) / 1e6).toFixed(6);
const k = (r) => JSON.parse(fs.readFileSync('keys/' + r + '.json', 'utf8'));
const EMPTY = '11111111111111111111111111111111';
const sleep = (ms) => new Promise((s) => setTimeout(s, ms));
let pass = 0, fail = 0;
const ok = (c, m) => { console.log((c ? '  PASS ' : '  FAIL ') + m); c ? pass++ : fail++; };
const msg = (e) => String((e && e.message) || e);

(async () => {
  const ks = new keyStores.InMemoryKeyStore();
  for (const r of ['fac', 'user', 'fees']) { const a = k(r); await ks.setKey('testnet', a.id, KeyPair.fromString(a.sk)); }
  const near = await connect({ networkId: 'testnet', keyStore: ks, nodeUrl: RPC });
  const fac = await near.account(k('fac').id), user = await near.account(k('user').id), fees = await near.account(k('fees').id);
  const prov = near.connection.provider;
  const rawAcct = (id) => prov.query({ request_type: 'view_account', finality: 'final', account_id: id });
  const bal = async (a) => BigInt((await rawAcct(a.accountId)).amount);
  const view = (c, m, a) => user.viewFunction({ contractId: c, methodName: m, args: a || {} });
  const keysOf = async (id) => (await prov.query({ request_type: 'view_access_key_list', finality: 'final', account_id: id })).keys;
  for (const a of [fac, user, fees]) console.log(a.accountId, N(await bal(a)), 'NEAR');

  // 1. deploy + init
  if ((await rawAcct(fac.accountId)).code_hash === EMPTY) {
    await fac.deployContract(fs.readFileSync(WASM));
    await fac.functionCall({ contractId: fac.accountId, methodName: 'new', args: { owner_id: fac.accountId, fee_account: fees.accountId, min_fee: Y(0.1) }, gas: '30000000000000' });
  }
  const cfg = await view(fac.accountId, 'get_config');
  console.log('config', JSON.stringify(cfg));
  ok(cfg.fee_account === fees.accountId && cfg.min_fee === Y(0.1), 'factory initialised with fee account + min fee');

  const prefix = 'solar' + Date.now().toString(36).slice(-4);
  const args = { prefix, name: 'Solar Flare', symbol: 'FLARE', decimals: 18, total_supply: '1000000000000000000000000000', icon: 'data:image/png;base64,iVBORw0KGgo=' };
  const req = BigInt(await view(fac.accountId, 'required_deposit', { args }));
  const sto = BigInt(await view(fac.accountId, 'storage_cost_of', { args }));
  console.log('required', N(req), 'storage', N(sto));
  const deposit = req + BigInt(Y(0.5)); // the page adds the USD-priced part on top of min_fee

  // 2. success path
  await sleep(2000);
  const fees0 = await bal(fees);
  const r = await user.functionCall({ contractId: fac.accountId, methodName: 'create_token', args: { args }, gas: '150000000000000', attachedDeposit: deposit.toString() });
  const logs = r.receipts_outcome.flatMap((o) => o.outcome.logs);
  const burnt = r.receipts_outcome.reduce((s, o) => s + o.outcome.gas_burnt, r.transaction_outcome.outcome.gas_burnt);
  console.log('gas burnt', (burnt / 1e12).toFixed(1), 'TGas');
  logs.forEach((l) => console.log('  log', l.slice(0, 220)));
  const tok = prefix + '.' + fac.accountId;
  await sleep(3000);
  const ta = await rawAcct(tok);
  ok(ta.code_hash !== EMPTY, 'token account created with code: ' + tok);
  ok((await keysOf(tok)).length === 0, 'token account has NO access keys');
  const usage = BigInt(ta.storage_usage) * 10n ** 19n;
  console.log('  token balance', N(ta.amount), 'storage locked', N(usage), 'bytes', ta.storage_usage);
  ok(BigInt(ta.amount) >= usage, 'token account balance covers its storage');
  const md = await view(tok, 'ft_metadata');
  ok(md.symbol === 'FLARE' && md.name === 'Solar Flare' && md.decimals === 18 && md.icon === args.icon, 'metadata as launched');
  ok((await view(tok, 'ft_balance_of', { account_id: user.accountId })) === args.total_supply, 'whole supply to launcher');
  ok((await view(tok, 'ft_total_supply')) === args.total_supply, 'total supply as launched');
  const feeGot = (await bal(fees)) - fees0;
  ok(feeGot === deposit - sto, 'fee account received exactly deposit - storage = ' + N(deposit - sto) + ' (got ' + N(feeGot) + ')');
  ok((await view(fac.accountId, 'get_tokens')).includes(tok), 'factory lists the token');
  ok(logs.some((l) => l.includes('token_created')), 'token_created event');

  // 3. failure path: same prefix again -> full refund
  const u0 = await bal(user), f0 = await bal(fees);
  const r2 = await user.functionCall({ contractId: fac.accountId, methodName: 'create_token', args: { args }, gas: '150000000000000', attachedDeposit: deposit.toString() });
  const logs2 = r2.receipts_outcome.flatMap((o) => o.outcome.logs);
  await sleep(4000);
  const lost = u0 - (await bal(user));
  console.log('  duplicate launch cost the user', N(lost), 'NEAR (gas only expected)');
  ok(logs2.some((l) => l.includes('token_refunded')), 'token_refunded event on duplicate prefix');
  ok(lost < BigInt(Y(0.05)), 'user refunded (lost < 0.05 NEAR, i.e. gas only)');
  ok((await bal(fees)) === f0, 'fee account untouched on failure');

  // 4. refusals before any promise
  const cases = [
    ['reserved prefix', { ...args, prefix: 'usdc' }, deposit, /reserved/],
    ['underpaid', { ...args, prefix: prefix + 'x' }, sto, /Attach at least/],
    ['svg icon', { ...args, prefix: prefix + 'y', icon: 'data:image/svg+xml;base64,AA' }, deposit, /Icon must/],
  ];
  for (const [label, a, dep, re] of cases) {
    try { await user.functionCall({ contractId: fac.accountId, methodName: 'create_token', args: { args: a }, gas: '150000000000000', attachedDeposit: dep.toString() }); ok(false, label + ' was accepted'); }
    catch (e) { ok(re.test(msg(e)), label + ' refused: ' + msg(e).slice(0, 100)); }
  }

  // 5. the token works: register the fee account and transfer to it
  const bounds = await view(tok, 'storage_balance_bounds');
  await fees.functionCall({ contractId: tok, methodName: 'storage_deposit', args: {}, gas: '30000000000000', attachedDeposit: bounds.min });
  await user.functionCall({ contractId: tok, methodName: 'ft_transfer', args: { receiver_id: fees.accountId, amount: '1000' }, gas: '30000000000000', attachedDeposit: '1' });
  ok((await view(tok, 'ft_balance_of', { account_id: fees.accountId })) === '1000', 'ft_transfer works after storage_deposit');
  ok((await view(tok, 'ft_total_supply')) === args.total_supply, 'supply unchanged');

  // 6. owner-only
  try { await user.functionCall({ contractId: fac.accountId, methodName: 'set_min_fee', args: { min_fee: '0' }, gas: '30000000000000' }); ok(false, 'non-owner set_min_fee accepted'); }
  catch (e) { ok(/Owner only/.test(msg(e)), 'non-owner set_min_fee refused'); }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
})().catch((e) => { console.error('ERROR', msg(e).slice(0, 600)); process.exit(1); });
