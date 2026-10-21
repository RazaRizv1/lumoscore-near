// Create throwaway TESTNET accounts via NEAR's testnet faucet helper. Keys stay in ./keys (scratchpad only).
const { KeyPair } = require('near-api-js');
const fs = require('fs');
fs.mkdirSync('keys', { recursive: true });
const tag = Date.now().toString(36);
(async () => {
  for (const role of ['fac', 'user', 'fees']) {
    const id = 'lx' + role + tag + '.testnet';
    const kp = KeyPair.fromRandom('ed25519');
    const r = await fetch('https://helper.testnet.near.org/account', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ newAccountId: id, newAccountPublicKey: kp.getPublicKey().toString() }),
    });
    const t = await r.text();
    console.log(role, id, r.status, t.slice(0, 160));
    if (r.ok) fs.writeFileSync('keys/' + role + '.json', JSON.stringify({ id, sk: kp.toString() }));
  }
})();
