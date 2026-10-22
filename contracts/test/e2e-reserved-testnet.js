// Testnet end-to-end for the factory's owner-only reserved path (create_reserved_token). Throwaway accounts.
// 2026-10-22 run: 10 passed, 0 failed (lumos.lxfacmvibsvuu.testnet minted to the treasury, fee 0, keyless).
// Redeploys the CURRENT factory wasm onto the existing testnet factory (state layout unchanged), then:
//   owner mints `lumos.<factory>` (reserved) with supply to a treasury, paying storage only;
//   a non-owner is refused; the public path still refuses `lumos`; earlier tokens still listed.
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

  const before = await view(fac.accountId, 'get_tokens');
  await fac.deployContract(fs.readFileSync(WASM));
  await sleep(2000);
  const cfg = await view(fac.accountId, 'get_config');
  ok(cfg.owner_id === fac.accountId && cfg.token_wasm_bytes > 0, 'upgraded factory keeps its state: owner ' + cfg.owner_id);
  ok(JSON.stringify(await view(fac.accountId, 'get_tokens')) === JSON.stringify(before), 'earlier tokens still listed (' + before.length + ')');

  const prefix = 'lumos';
  const args = { prefix, name: 'LumosCore', symbol: 'LUMOS', decimals: 18, total_supply: '1000000000000000000000000000' };
  const tok = prefix + '.' + fac.accountId;
  const exists = await rawAcct(tok).then(() => true, () => false);
  const sto = BigInt(await view(fac.accountId, 'storage_cost_of', { args }));

  // the public path still refuses a reserved name, even for the owner
  try { await fac.functionCall({ contractId: fac.accountId, methodName: 'create_token', args: { args }, gas: '150000000000000', attachedDeposit: Y(3) }); ok(false, 'public path accepted lumos'); }
  catch (e) { ok(/reserved/.test(msg(e)), 'public create_token refuses "lumos"'); }

  // a non-owner cannot use the reserved path
  try { await user.functionCall({ contractId: fac.accountId, methodName: 'create_reserved_token', args: { args, owner_id: user.accountId }, gas: '150000000000000', attachedDeposit: Y(3) }); ok(false, 'non-owner reserved launch accepted'); }
  catch (e) { ok(/Owner only/.test(msg(e)), 'non-owner create_reserved_token refused'); }

  if (exists) { console.log('  (lumos token already exists from an earlier run; skipping the mint)'); }
  else {
    const fees0 = await bal(fees);
    const r = await fac.functionCall({ contractId: fac.accountId, methodName: 'create_reserved_token', args: { args, owner_id: fees.accountId }, gas: '150000000000000', attachedDeposit: sto.toString() });
    const logs = r.receipts_outcome.flatMap((o) => o.outcome.logs);
    logs.forEach((l) => console.log('  log', l.slice(0, 200)));
    await sleep(3000);
    const ta = await rawAcct(tok);
    ok(ta.code_hash !== EMPTY, 'owner minted reserved token ' + tok);
    ok((await keysOf(tok)).length === 0, 'reserved token account has NO access keys');
    ok((await view(tok, 'ft_balance_of', { account_id: fees.accountId })) === args.total_supply, 'whole supply to the named treasury (' + fees.accountId + ')');
    ok((await view(tok, 'ft_balance_of', { account_id: fac.accountId })) === '0', 'none to the caller (factory owner)');
    ok((await bal(fees)) === fees0, 'no LumosCore fee taken on the owner path (deposit was exactly storage ' + N(sto) + ' NEAR)');
    ok((await view(fac.accountId, 'get_tokens')).includes(tok), 'factory lists the reserved token');
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
})().catch((e) => { console.error('ERROR', msg(e).slice(0, 600)); process.exit(1); });
