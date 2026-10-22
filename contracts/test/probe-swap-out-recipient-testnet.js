// Testnet probe: does Ref (ref-finance-101.testnet, v1.9.19) honour `swap_out_recipient` in an instant swap?
// user sends 0.1 wNEAR into pool 17 (wrap.testnet -> ref.fakes.testnet) with the output addressed to `fees`.
const { connect, keyStores, KeyPair, utils } = require('near-api-js');
const fs = require('fs');
process.chdir(__dirname);
const RPC = 'https://test.rpc.fastnear.com';
const REF = 'ref-finance-101.testnet', WN = 'wrap.testnet', OUT = 'ref.fakes.testnet';
const Y = (n) => utils.format.parseNearAmount(String(n));
const k = (r) => JSON.parse(fs.readFileSync('keys/' + r + '.json', 'utf8'));
const sleep = (ms) => new Promise((s) => setTimeout(s, ms));
(async () => {
  const ks = new keyStores.InMemoryKeyStore();
  for (const r of ['user', 'fees']) { const a = k(r); await ks.setKey('testnet', a.id, KeyPair.fromString(a.sk)); }
  const near = await connect({ networkId: 'testnet', keyStore: ks, nodeUrl: RPC });
  const user = await near.account(k('user').id), fees = await near.account(k('fees').id);
  const view = (c, m, a) => user.viewFunction({ contractId: c, methodName: m, args: a || {} });
  const reg = async (acct, token) => {
    if (await view(token, 'storage_balance_of', { account_id: acct })) return;
    const b = await view(token, 'storage_balance_bounds');
    await user.functionCall({ contractId: token, methodName: 'storage_deposit', args: { account_id: acct, registration_only: true }, gas: '30000000000000', attachedDeposit: b.min });
  };
  await reg(user.accountId, WN); await reg(user.accountId, OUT); await reg(fees.accountId, OUT);
  await user.functionCall({ contractId: WN, methodName: 'near_deposit', args: {}, gas: '10000000000000', attachedDeposit: Y(0.1) });
  const u0 = BigInt(await view(OUT, 'ft_balance_of', { account_id: user.accountId }));
  const f0 = BigInt(await view(OUT, 'ft_balance_of', { account_id: fees.accountId }));
  const msg = JSON.stringify({ actions: [{ pool_id: 17, token_in: WN, token_out: OUT, min_amount_out: '1' }], swap_out_recipient: fees.accountId });
  const r = await user.functionCall({ contractId: WN, methodName: 'ft_transfer_call', args: { receiver_id: REF, amount: Y(0.1), msg }, gas: '200000000000000', attachedDeposit: '1' });
  const logs = r.receipts_outcome.flatMap((o) => o.outcome.logs);
  logs.forEach((l) => console.log('  log', l.slice(0, 220)));
  await sleep(4000);
  const u1 = BigInt(await view(OUT, 'ft_balance_of', { account_id: user.accountId }));
  const f1 = BigInt(await view(OUT, 'ft_balance_of', { account_id: fees.accountId }));
  console.log('output to sender:', (u1 - u0).toString(), ' output to swap_out_recipient:', (f1 - f0).toString());
  console.log((f1 > f0 && u1 === u0) ? 'RESULT: swap_out_recipient IS honoured' : (u1 > u0 ? 'RESULT: field ignored, output went to the sender' : 'RESULT: no output seen'));
})().catch((e) => { console.error('ERROR', String((e && e.message) || e).slice(0, 600)); process.exit(1); });
