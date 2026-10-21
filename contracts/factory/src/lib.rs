//! LumosCore Launchpad factory, deployed on `lumoscore.near`.
//!
//! `create_token` creates `<prefix>.lumoscore.near`, funds exactly its storage, deploys the fixed-supply
//! token (contracts/token, embedded below), and mints the whole supply to the caller, all in ONE receipt.
//! Either every action lands or none does: no half-made token, no account without code.
//!
//! The new account gets NO access keys, so nobody (not the launcher, not LumosCore) can ever redeploy it
//! or mint more. That is the padlock rule: no full-access keys AND no mint method.
//!
//! Money: the caller attaches `required_deposit` = storage for the new account + `min_fee`. Anything above
//! the storage goes to `fee_account` (fees-lumoscore.near), but only AFTER the token exists. If creation
//! fails (prefix taken, bad metadata, out of gas), the callback refunds the WHOLE deposit to the caller.
//!
//! Keep at least ~3 NEAR liquid on the factory account above its own storage: on a failed launch the
//! storage it forwarded comes back as a separate refund receipt, which may land after the callback has
//! already refunded the caller from the factory's own balance.
use near_sdk::json_types::U128;
use near_sdk::serde_json::{self, json};
use near_sdk::store::Vector;
use near_sdk::{
    env, near, require, AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseError,
};

/// Built by `cargo near build non-reproducible-wasm --no-abi` in contracts/token. Rebuild the token
/// BEFORE the factory; build.sh does both in order.
const TOKEN_WASM: &[u8] = include_bytes!("../../token/target/near/lumoscore_token.wasm");

const GAS_NEW: Gas = Gas::from_tgas(30);
const GAS_CALLBACK: Gas = Gas::from_tgas(15);
/// Below this the callback might not get enough gas to refund a failed launch, so the call is refused.
const MIN_PREPAID: Gas = Gas::from_tgas(100);
/// The new account's record, the token's own state and the owner's balance entry, with headroom.
const EXTRA_BYTES: u64 = 2_000;
const MAX_ICON: usize = 16 * 1024;
const MAX_NAME: usize = 48;

/// Prefixes that would let a launch pass itself off as LumosCore, NEAR infrastructure or a major
/// stablecoin. `usdc.lumoscore.near` must never exist.
const RESERVED: &[&str] = &[
    "lumos", "lumoscore", "lumoscorefees", "fees", "fee", "admin", "owner", "factory", "launch",
    "launchpad", "app", "api", "www", "docs", "near", "wnear", "wrap", "usdc", "usdt", "usd", "dai",
    "eth", "weth", "btc", "wbtc", "official", "team", "support", "treasury", "rewards", "swap",
    "bridge", "pool", "pools", "staking",
];

#[near(serializers = [json])]
#[derive(Clone)]
pub struct TokenArgs {
    /// The `<prefix>` in `<prefix>.lumoscore.near`: 2-32 of a-z 0-9, single hyphens between.
    pub prefix: String,
    pub name: String,
    /// 2-12 of A-Z 0-9, starting with a letter.
    pub symbol: String,
    pub decimals: u8,
    pub total_supply: U128,
    /// A data:image/png|jpeg|webp;base64 URL, at most 16 KB. SVG is refused: it can carry script.
    pub icon: Option<String>,
}

#[near(serializers = [json])]
pub struct Config {
    pub owner_id: AccountId,
    pub fee_account: AccountId,
    pub min_fee: U128,
    pub paused: bool,
    pub token_wasm_bytes: u64,
    pub tokens_created: u32,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Factory {
    owner_id: AccountId,
    fee_account: AccountId,
    min_fee: NearToken,
    paused: bool,
    tokens: Vector<AccountId>,
}

fn valid_prefix(p: &str) -> bool {
    let b = p.as_bytes();
    if b.len() < 2 || b.len() > 32 {
        return false;
    }
    let alnum = |c: u8| c.is_ascii_lowercase() || c.is_ascii_digit();
    if !alnum(b[0]) || !alnum(b[b.len() - 1]) {
        return false;
    }
    for i in 0..b.len() {
        let c = b[i];
        if c == b'-' {
            if b[i - 1] == b'-' {
                return false;
            }
        } else if !alnum(c) {
            return false;
        }
    }
    true
}

fn valid_symbol(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() >= 2
        && b.len() <= 12
        && b[0].is_ascii_uppercase()
        && b.iter().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit())
}

fn valid_name(n: &str) -> bool {
    !n.is_empty() && n.len() <= MAX_NAME && n.trim() == n && !n.chars().any(|c| c.is_control())
}

fn valid_icon(i: &str) -> bool {
    i.len() <= MAX_ICON
        && ["data:image/png;base64,", "data:image/jpeg;base64,", "data:image/webp;base64,"]
            .iter()
            .any(|p| i.starts_with(p))
}

impl Factory {
    fn assert_owner(&self) {
        require!(env::predecessor_account_id() == self.owner_id, "Owner only");
    }

    fn validate(&self, a: &TokenArgs) {
        require!(valid_prefix(&a.prefix), "Bad prefix: 2-32 of a-z 0-9, single hyphens between");
        require!(!RESERVED.contains(&a.prefix.as_str()), "That name is reserved");
        require!(valid_symbol(&a.symbol), "Bad symbol: 2-12 of A-Z 0-9, starting with a letter");
        require!(valid_name(&a.name), "Bad name: 1-48 characters, no leading/trailing spaces");
        require!(a.decimals <= 24, "Decimals must be 0-24");
        require!(a.total_supply.0 > 0, "Total supply must be positive");
        if let Some(i) = &a.icon {
            require!(valid_icon(i), "Icon must be a PNG/JPEG/WebP data URL of at most 16 KB");
        }
    }

    fn storage_bytes(a: &TokenArgs) -> u64 {
        TOKEN_WASM.len() as u64
            + a.name.len() as u64
            + a.symbol.len() as u64
            + a.icon.as_ref().map_or(0, |i| i.len() as u64)
            + EXTRA_BYTES
    }

    fn storage_cost(a: &TokenArgs) -> NearToken {
        env::storage_byte_cost().saturating_mul(Self::storage_bytes(a) as u128)
    }
}

#[near]
impl Factory {
    #[init]
    pub fn new(owner_id: AccountId, fee_account: AccountId, min_fee: U128) -> Self {
        Self {
            owner_id,
            fee_account,
            min_fee: NearToken::from_yoctonear(min_fee.0),
            paused: false,
            tokens: Vector::new(b"t"),
        }
    }

    // ---- launch ------------------------------------------------------------------------------------

    #[payable]
    pub fn create_token(&mut self, args: TokenArgs) -> Promise {
        require!(!self.paused, "Launches are paused");
        self.validate(&args);
        require!(env::prepaid_gas() >= MIN_PREPAID, "Attach at least 100 TGas");

        let token_id: AccountId = format!("{}.{}", args.prefix, env::current_account_id())
            .parse()
            .unwrap_or_else(|_| env::panic_str("Bad token account id"));
        let storage = Self::storage_cost(&args);
        let deposit = env::attached_deposit();
        let required = storage.saturating_add(self.min_fee);
        require!(
            deposit >= required,
            format!("Attach at least {} yoctoNEAR", required.as_yoctonear())
        );

        let owner = env::predecessor_account_id();
        let init = serde_json::to_vec(&json!({
            "owner_id": owner,
            "total_supply": args.total_supply,
            "metadata": {
                "spec": "ft-1.0.0",
                "name": args.name,
                "symbol": args.symbol,
                "icon": args.icon,
                "reference": null,
                "reference_hash": null,
                "decimals": args.decimals,
            }
        }))
        .unwrap();

        Promise::new(token_id.clone())
            .create_account()
            .transfer(storage)
            .deploy_contract(TOKEN_WASM.to_vec())
            .function_call("new".to_string(), init, NearToken::from_yoctonear(0), GAS_NEW)
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_CALLBACK)
                    .on_token_created(token_id, owner, U128(deposit.as_yoctonear()), U128(storage.as_yoctonear())),
            )
    }

    #[private]
    pub fn on_token_created(
        &mut self,
        token_id: AccountId,
        owner_id: AccountId,
        deposit: U128,
        storage: U128,
        #[callback_result] result: Result<(), PromiseError>,
    ) -> bool {
        if result.is_ok() {
            let fee = deposit.0.saturating_sub(storage.0);
            if fee > 0 {
                Promise::new(self.fee_account.clone()).transfer(NearToken::from_yoctonear(fee)).detach();
            }
            self.tokens.push(token_id.clone());
            env::log_str(&format!(
                "EVENT_JSON:{}",
                json!({
                    "standard": "lumoscore_launch",
                    "version": "1.0.0",
                    "event": "token_created",
                    "data": [{ "token_id": token_id, "owner_id": owner_id, "fee": U128(fee) }]
                })
            ));
            true
        } else {
            Promise::new(owner_id.clone()).transfer(NearToken::from_yoctonear(deposit.0)).detach();
            env::log_str(&format!(
                "EVENT_JSON:{}",
                json!({
                    "standard": "lumoscore_launch",
                    "version": "1.0.0",
                    "event": "token_refunded",
                    "data": [{ "token_id": token_id, "owner_id": owner_id, "amount": deposit }]
                })
            ));
            false
        }
    }

    // ---- views -------------------------------------------------------------------------------------

    /// What `create_token` will demand for these arguments: storage + min_fee, in yoctoNEAR. The page
    /// adds the USD-priced part of the fee on top, so the fee account still receives the full price.
    pub fn required_deposit(&self, args: TokenArgs) -> U128 {
        self.validate(&args);
        U128(Self::storage_cost(&args).saturating_add(self.min_fee).as_yoctonear())
    }

    pub fn storage_cost_of(&self, args: TokenArgs) -> U128 {
        U128(Self::storage_cost(&args).as_yoctonear())
    }

    pub fn get_config(&self) -> Config {
        Config {
            owner_id: self.owner_id.clone(),
            fee_account: self.fee_account.clone(),
            min_fee: U128(self.min_fee.as_yoctonear()),
            paused: self.paused,
            token_wasm_bytes: TOKEN_WASM.len() as u64,
            tokens_created: self.tokens.len(),
        }
    }

    pub fn get_tokens(&self, from_index: Option<u32>, limit: Option<u32>) -> Vec<AccountId> {
        let from = from_index.unwrap_or(0);
        let limit = limit.unwrap_or(100).min(500);
        (from..self.tokens.len().min(from.saturating_add(limit)))
            .filter_map(|i| self.tokens.get(i).cloned())
            .collect()
    }

    // ---- owner -------------------------------------------------------------------------------------

    pub fn set_min_fee(&mut self, min_fee: U128) {
        self.assert_owner();
        self.min_fee = NearToken::from_yoctonear(min_fee.0);
    }

    pub fn set_fee_account(&mut self, fee_account: AccountId) {
        self.assert_owner();
        self.fee_account = fee_account;
    }

    pub fn set_paused(&mut self, paused: bool) {
        self.assert_owner();
        self.paused = paused;
    }

    pub fn set_owner(&mut self, owner_id: AccountId) {
        self.assert_owner();
        self.owner_id = owner_id;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{accounts, get_logs, VMContextBuilder};
    use near_sdk::{testing_env, PromiseResult};

    fn args(prefix: &str) -> TokenArgs {
        TokenArgs {
            prefix: prefix.to_string(),
            name: "Solar Flare".to_string(),
            symbol: "FLARE".to_string(),
            decimals: 18,
            total_supply: U128(1_000_000_000_000_000_000_000_000_000),
            icon: None,
        }
    }

    fn setup() -> (VMContextBuilder, Factory) {
        let mut ctx = VMContextBuilder::new();
        ctx.current_account_id("lumoscore.near".parse().unwrap())
            .predecessor_account_id(accounts(1))
            .prepaid_gas(Gas::from_tgas(150));
        testing_env!(ctx.build());
        let f = Factory::new(
            accounts(0),
            "fees-lumoscore.near".parse().unwrap(),
            U128(NearToken::from_millinear(100).as_yoctonear()),
        );
        (ctx, f)
    }

    #[test]
    fn names() {
        for ok in ["ab", "solar", "solar-flare", "a1-b2-c3", "x9"] {
            assert!(valid_prefix(ok), "{ok}");
        }
        for bad in ["a", "-ab", "ab-", "a--b", "Ab", "a_b", "a.b", "a b", ""] {
            assert!(!valid_prefix(bad), "{bad}");
        }
        assert!(valid_symbol("FLARE") && valid_symbol("AB") && valid_symbol("X2Y"));
        for bad in ["A", "flare", "1AB", "ABCDEFGHIJKLM", "AB-C"] {
            assert!(!valid_symbol(bad), "{bad}");
        }
        assert!(valid_icon("data:image/png;base64,AAAA"));
        assert!(!valid_icon("data:image/svg+xml;base64,AAAA"));
        assert!(!valid_icon("https://x/y.png"));
    }

    #[test]
    fn required_deposit_is_storage_plus_min_fee() {
        let (_, f) = setup();
        let a = args("solar");
        let storage = Factory::storage_cost(&a).as_yoctonear();
        assert_eq!(f.required_deposit(a).0, storage + NearToken::from_millinear(100).as_yoctonear());
        // ~1.66 NEAR for the 164 KB token: in the right ballpark, not off by a factor.
        assert!(storage > NearToken::from_near(1).as_yoctonear());
        assert!(storage < NearToken::from_near(3).as_yoctonear());
    }

    #[test]
    #[should_panic(expected = "That name is reserved")]
    fn reserved_prefix_is_refused() {
        let (mut ctx, mut f) = setup();
        testing_env!(ctx.attached_deposit(NearToken::from_near(5)).build());
        f.create_token(args("usdc"));
    }

    #[test]
    #[should_panic(expected = "Attach at least")]
    fn underpaying_is_refused() {
        let (mut ctx, mut f) = setup();
        testing_env!(ctx.attached_deposit(NearToken::from_near(1)).build());
        f.create_token(args("solar"));
    }

    #[test]
    #[should_panic(expected = "Attach at least 100 TGas")]
    fn too_little_gas_is_refused() {
        let (mut ctx, mut f) = setup();
        testing_env!(ctx.attached_deposit(NearToken::from_near(5)).prepaid_gas(Gas::from_tgas(50)).build());
        f.create_token(args("solar"));
    }

    #[test]
    #[should_panic(expected = "Launches are paused")]
    fn paused_refuses() {
        let (mut ctx, mut f) = setup();
        testing_env!(ctx.predecessor_account_id(accounts(0)).build());
        f.set_paused(true);
        testing_env!(ctx.predecessor_account_id(accounts(1)).attached_deposit(NearToken::from_near(5)).build());
        f.create_token(args("solar"));
    }

    #[test]
    #[should_panic(expected = "Owner only")]
    fn only_owner_sets_fee() {
        let (_, mut f) = setup();
        f.set_min_fee(U128(0));
    }

    #[test]
    fn success_records_token_and_pays_fee() {
        let (mut ctx, mut f) = setup();
        testing_env!(
            ctx.predecessor_account_id("lumoscore.near".parse().unwrap()).build(),
            near_sdk::test_vm_config(),
            near_sdk::RuntimeFeesConfig::test(),
            Default::default(),
            vec![PromiseResult::Successful(vec![])],
        );
        let ok = f.on_token_created(
            "solar.lumoscore.near".parse().unwrap(),
            accounts(1),
            U128(3_000),
            U128(1_000),
            Ok(()),
        );
        assert!(ok);
        assert_eq!(f.get_tokens(None, None), vec!["solar.lumoscore.near".parse::<AccountId>().unwrap()]);
        assert!(get_logs()[0].contains("\"token_created\"") && get_logs()[0].contains("\"fee\":\"2000\""));
    }

    #[test]
    fn failure_refunds_and_records_nothing() {
        let (mut ctx, mut f) = setup();
        testing_env!(
            ctx.predecessor_account_id("lumoscore.near".parse().unwrap()).build(),
            near_sdk::test_vm_config(),
            near_sdk::RuntimeFeesConfig::test(),
            Default::default(),
            vec![PromiseResult::Failed],
        );
        let ok = f.on_token_created(
            "solar.lumoscore.near".parse().unwrap(),
            accounts(1),
            U128(3_000),
            U128(1_000),
            Err(PromiseError::Failed),
        );
        assert!(!ok);
        assert!(f.get_tokens(None, None).is_empty());
        assert!(get_logs()[0].contains("\"token_refunded\"") && get_logs()[0].contains("\"amount\":\"3000\""));
    }
}
