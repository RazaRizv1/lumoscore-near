// 2026-10-22 run: the page's NEAR-input shape (wrap + router call at 280 TGas) swapped fine, 29.1 TGas burnt, fee memo lx:sw.
const { connect, keyStores, KeyPair, utils } = require('near-api-js');
const fs = require('fs'); process.chdir(__dirname);
const k = (r) => JSON.parse(fs.readFileSync('keys/' + r + '.json', 'utf8'));
(async () => {
  const ks = new keyStores.InMemoryKeyStore();
  for (const r of ['user', 'rtr']) { const a = k(r); await ks.setKey('testnet', a.id, KeyPair.fromString(a.sk)); }
  const near = await connect({ networkId: 'testnet', keyStore: ks, nodeUrl: 'https://test.rpc.fastnear.com' });
  const user = await near.account(k('user').id);
  const view = (c, m, a) => user.viewFunction({ contractId: c, methodName: m, args: a || {} });
  const before = BigInt(await view('ref.fakes.testnet', 'ft_balance_of', { account_id: user.accountId }));
  // the page's NEAR-input shape: wrap + router call in ONE transaction, router call capped at 280 TGas
  const r = await user.signAndSendTransaction({ receiverId: 'wrap.testnet', actions: [
    require('near-api-js').transactions.functionCall('near_deposit', {}, BigInt('10000000000000'), BigInt(utils.format.parseNearAmount('0.05'))),
    require('near-api-js').transactions.functionCall('ft_transfer_call', { receiver_id: k('rtr').id, amount: utils.format.parseNearAmount('0.05'),
      msg: JSON.stringify({ fee_bps: 20, actions: [{ pool_id: 17, token_in: 'wrap.testnet', token_out: 'ref.fakes.testnet', min_amount_out: '1' }] }) },
      BigInt('280000000000000'), BigInt(1)) ] });
  const burnt = r.receipts_outcome.reduce((s, o) => s + o.outcome.gas_burnt, r.transaction_outcome.outcome.gas_burnt);
  const fails = r.receipts_outcome.filter((o) => o.outcome.status && o.outcome.status.Failure).length;
  await new Promise((s) => setTimeout(s, 4000));
  const after = BigInt(await view('ref.fakes.testnet', 'ft_balance_of', { account_id: user.accountId }));
  console.log('gas burnt', (burnt / 1e12).toFixed(1), 'TGas; failed receipts', fails, '; output received', (after - before).toString(),
    r.receipts_outcome.flatMap((o) => o.outcome.logs).some((l) => l.includes('"event":"swap"')) ? '; swap event OK' : '; NO swap event');
})().catch((e) => { console.error('ERROR', String(e.message || e).slice(0, 400)); process.exit(1); });
