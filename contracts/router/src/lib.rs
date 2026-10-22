//! LumosCore swap router: the platform fee is taken only if the Rhea swap succeeds.
//!
//! Before this, a NEAR swap was one transaction with two actions: ft_transfer of the fee to the fee account,
//! then ft_transfer_call into Rhea. A swap Rhea refused (the price moved past the minimum) returned the input
//! but the fee had already gone. RAZA accepted that for v1 ("we can do a router contract later").
//!
//! Flow, all inside the one ft_transfer_call the user signs:
//!   1. user: <token>.ft_transfer_call(router, amount, msg = {"fee_bps", "actions", "skip_unwrap_near"?})
//!   2. router.ft_on_transfer: fee = amount × fee_bps / 10000, net = amount − fee, then
//!      <token>.ft_transfer_call(rhea, net, {"force":0, actions, skip_unwrap_near, swap_out_recipient: user})
//!      so the OUTPUT goes straight to the user (verified on testnet 2026-10-22: Ref 1.9.19 honours
//!      swap_out_recipient; mainnet runs 1.9.20).
//!   3. router.on_swapped: Rhea used all of `net` → the fee goes to the fee account and nothing is returned.
//!      Anything less → every unused unit AND the fee are returned. The value returned here is what the token
//!      contract's own ft_resolve_transfer hands back to the user, so the refund needs no transfer of ours.
//!
//! The router keeps no per-swap state and holds tokens only for the length of one swap. It must be
//! storage-registered on every token it routes (the same requirement the fee account already has).
//! The fee rate comes from the caller, capped at max_fee_bps: anyone can trade on Rhea directly with no fee
//! at all, so the router enforces atomicity, not payment.
use near_sdk::json_types::U128;
use near_sdk::serde_json::{self, json, Value};
use near_sdk::{
    env, near, require, AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseError,
    PromiseOrValue,
};

/// The swap: the token's transfer to Rhea, Rhea's swap, its output transfer and the token's resolve.
/// Multi-hop routes need the most; 180 TGas leaves room for three hops.
const GAS_SWAP: Gas = Gas::from_tgas(180);
const GAS_CALLBACK: Gas = Gas::from_tgas(25);
const GAS_FT_TRANSFER: Gas = Gas::from_tgas(10);
const ONE_YOCTO: NearToken = NearToken::from_yoctonear(1);
const HARD_MAX_FEE_BPS: u16 = 100;

#[near(serializers = [json])]
pub struct SwapMsg {
    /// The platform fee in basis points: 20 (0.2%), or 10 for a 250,000-LUMOS holder.
    pub fee_bps: u16,
    /// Rhea swap actions, passed through unchanged (pool_id, token_in, token_out, amount_in?, min_amount_out).
    pub actions: Vec<Value>,
    #[serde(default)]
    pub skip_unwrap_near: Option<bool>,
}

#[near(serializers = [json])]
pub struct Config {
    pub owner_id: AccountId,
    pub fee_account: AccountId,
    pub rhea: AccountId,
    pub max_fee_bps: u16,
    pub paused: bool,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Router {
    owner_id: AccountId,
    fee_account: AccountId,
    rhea: AccountId,
    max_fee_bps: u16,
    paused: bool,
}

impl Router {
    fn assert_owner(&self) {
        require!(env::predecessor_account_id() == self.owner_id, "Owner only");
    }

    fn fee_of(amount: u128, fee_bps: u16) -> u128 {
        // amount × bps / 10000 without overflow for any u128 amount
        (amount / 10_000) * fee_bps as u128 + (amount % 10_000) * fee_bps as u128 / 10_000
    }
}

#[near]
impl Router {
    #[init]
    pub fn new(owner_id: AccountId, fee_account: AccountId, rhea: AccountId, max_fee_bps: u16) -> Self {
        require!(max_fee_bps <= HARD_MAX_FEE_BPS, "max_fee_bps above 1%");
        Self { owner_id, fee_account, rhea, max_fee_bps, paused: false }
    }

    /// NEP-141 receiver. A panic here makes the token return the whole amount to the sender.
    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> PromiseOrValue<U128> {
        require!(!self.paused, "Router is paused");
        let m: SwapMsg = serde_json::from_str(&msg).unwrap_or_else(|_| env::panic_str("Bad swap message"));
        require!(m.fee_bps <= self.max_fee_bps, "Fee above the router's cap");
        require!(!m.actions.is_empty(), "No swap actions");
        let token = env::predecessor_account_id();
        let fee = Self::fee_of(amount.0, m.fee_bps);
        let net = amount.0 - fee;
        require!(net > 0, "Nothing left to swap");

        let rhea_msg = json!({
            "force": 0,
            "actions": m.actions,
            "skip_unwrap_near": m.skip_unwrap_near.unwrap_or(false),
            "swap_out_recipient": sender_id,
        })
        .to_string();
        let args = serde_json::to_vec(&json!({
            "receiver_id": self.rhea,
            "amount": U128(net),
            "msg": rhea_msg,
        }))
        .unwrap();

        PromiseOrValue::Promise(
            Promise::new(token.clone())
                .function_call("ft_transfer_call".to_string(), args, ONE_YOCTO, GAS_SWAP)
                .then(
                    Self::ext(env::current_account_id())
                        .with_static_gas(GAS_CALLBACK)
                        .on_swapped(sender_id, token, amount, U128(fee), U128(net)),
                ),
        )
    }

    /// Returns the amount the token gives back to the user (0 when the swap went through).
    #[private]
    pub fn on_swapped(
        &mut self,
        sender_id: AccountId,
        token: AccountId,
        amount: U128,
        fee: U128,
        net: U128,
        #[callback_result] used: Result<U128, PromiseError>,
    ) -> U128 {
        // Rhea's used amount; a failed ft_transfer_call moved nothing, so the router still holds all of it.
        let used = used.map(|u| u.0).unwrap_or(0).min(net.0);
        if used == net.0 {
            if fee.0 > 0 {
                let args = serde_json::to_vec(&json!({
                    "receiver_id": self.fee_account,
                    "amount": fee,
                    "memo": "lx:sw",
                }))
                .unwrap();
                Promise::new(token.clone())
                    .function_call("ft_transfer".to_string(), args, ONE_YOCTO, GAS_FT_TRANSFER)
                    .detach();
            }
            env::log_str(&format!(
                "EVENT_JSON:{}",
                json!({ "standard": "lumoscore_router", "version": "1.0.0", "event": "swap",
                        "data": [{ "account_id": sender_id, "token": token, "amount": amount, "fee": fee }] })
            ));
            U128(0)
        } else {
            let back = amount.0 - used;
            env::log_str(&format!(
                "EVENT_JSON:{}",
                json!({ "standard": "lumoscore_router", "version": "1.0.0", "event": "swap_refunded",
                        "data": [{ "account_id": sender_id, "token": token, "amount": amount, "refund": U128(back) }] })
            ));
            U128(back)
        }
    }

    // ---- views -------------------------------------------------------------------------------------

    pub fn get_config(&self) -> Config {
        Config {
            owner_id: self.owner_id.clone(),
            fee_account: self.fee_account.clone(),
            rhea: self.rhea.clone(),
            max_fee_bps: self.max_fee_bps,
            paused: self.paused,
        }
    }

    // ---- owner -------------------------------------------------------------------------------------

    pub fn set_paused(&mut self, paused: bool) {
        self.assert_owner();
        self.paused = paused;
    }

    pub fn set_fee_account(&mut self, fee_account: AccountId) {
        self.assert_owner();
        self.fee_account = fee_account;
    }

    pub fn set_owner(&mut self, owner_id: AccountId) {
        self.assert_owner();
        self.owner_id = owner_id;
    }

    /// Storage-register the router on a token it will route. The owner attaches the token's minimum.
    #[payable]
    pub fn register_token(&mut self, token: AccountId) -> Promise {
        self.assert_owner();
        let args = serde_json::to_vec(&json!({ "account_id": env::current_account_id(), "registration_only": true })).unwrap();
        Promise::new(token).function_call("storage_deposit".to_string(), args, env::attached_deposit(), GAS_FT_TRANSFER)
    }

    /// Recovery: tokens can only be stranded here if a fee transfer failed (fee account not registered on
    /// that token). The owner sends them on.
    pub fn withdraw(&mut self, token: AccountId, amount: U128, receiver_id: AccountId) -> Promise {
        self.assert_owner();
        let args = serde_json::to_vec(&json!({ "receiver_id": receiver_id, "amount": amount })).unwrap();
        Promise::new(token).function_call("ft_transfer".to_string(), args, ONE_YOCTO, GAS_FT_TRANSFER)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{accounts, get_logs, VMContextBuilder};
    use near_sdk::{testing_env, PromiseResult};

    fn setup() -> (VMContextBuilder, Router) {
        let mut ctx = VMContextBuilder::new();
        ctx.current_account_id("router.lumoscore.near".parse().unwrap())
            .predecessor_account_id("usdc.near".parse().unwrap())
            .prepaid_gas(Gas::from_tgas(280));
        testing_env!(ctx.build());
        let r = Router::new(accounts(0), "fees-lumoscore.near".parse().unwrap(), "v2.ref-finance.near".parse().unwrap(), 20);
        (ctx, r)
    }

    fn msg(fee_bps: u16) -> String {
        json!({ "fee_bps": fee_bps, "actions": [{ "pool_id": 1, "token_in": "usdc.near", "token_out": "wrap.near", "min_amount_out": "1" }] }).to_string()
    }

    fn callback(ok: Option<u128>) -> (VMContextBuilder, Router) {
        let (mut ctx, r) = setup();
        let res = match ok { Some(u) => PromiseResult::Successful(serde_json::to_vec(&U128(u)).unwrap()), None => PromiseResult::Failed };
        testing_env!(
            ctx.predecessor_account_id("router.lumoscore.near".parse().unwrap()).build(),
            near_sdk::test_vm_config(),
            near_sdk::RuntimeFeesConfig::test(),
            Default::default(),
            vec![res],
        );
        (ctx, r)
    }

    #[test]
    fn fee_math() {
        assert_eq!(Router::fee_of(1_000_000, 20), 2_000);
        assert_eq!(Router::fee_of(1_000_000, 10), 1_000);
        assert_eq!(Router::fee_of(9_999, 20), 19);
        assert_eq!(Router::fee_of(u128::MAX, 20), u128::MAX / 10_000 * 20 + (u128::MAX % 10_000) * 20 / 10_000);
        assert_eq!(Router::fee_of(5, 20), 0);
    }

    #[test]
    fn accepts_a_swap() {
        let (_, mut r) = setup();
        match r.ft_on_transfer(accounts(1), U128(1_000_000), msg(20)) {
            PromiseOrValue::Promise(_) => {}
            _ => panic!("expected a promise"),
        }
    }

    #[test]
    #[should_panic(expected = "Fee above the router's cap")]
    fn fee_cap() {
        let (_, mut r) = setup();
        let _ = r.ft_on_transfer(accounts(1), U128(1_000_000), msg(21));
    }

    #[test]
    #[should_panic(expected = "Bad swap message")]
    fn garbage_msg() {
        let (_, mut r) = setup();
        let _ = r.ft_on_transfer(accounts(1), U128(1_000_000), "{".to_string());
    }

    #[test]
    #[should_panic(expected = "No swap actions")]
    fn empty_actions() {
        let (_, mut r) = setup();
        let _ = r.ft_on_transfer(accounts(1), U128(1_000_000), json!({ "fee_bps": 20, "actions": [] }).to_string());
    }

    #[test]
    #[should_panic(expected = "Router is paused")]
    fn paused() {
        let (mut ctx, mut r) = setup();
        testing_env!(ctx.predecessor_account_id(accounts(0)).build());
        r.set_paused(true);
        testing_env!(ctx.predecessor_account_id("usdc.near".parse().unwrap()).build());
        let _ = r.ft_on_transfer(accounts(1), U128(1_000_000), msg(20));
    }

    #[test]
    fn success_keeps_the_fee_and_returns_nothing() {
        let (_, mut r) = callback(Some(998_000));
        let back = r.on_swapped(accounts(1), "usdc.near".parse().unwrap(), U128(1_000_000), U128(2_000), U128(998_000), Ok(U128(998_000)));
        assert_eq!(back.0, 0);
        assert!(get_logs()[0].contains("\"event\":\"swap\"") && get_logs()[0].contains("\"fee\":\"2000\""));
    }

    #[test]
    fn refused_swap_returns_everything_including_the_fee() {
        let (_, mut r) = callback(Some(0));
        let back = r.on_swapped(accounts(1), "usdc.near".parse().unwrap(), U128(1_000_000), U128(2_000), U128(998_000), Ok(U128(0)));
        assert_eq!(back.0, 1_000_000);
        assert!(get_logs()[0].contains("swap_refunded"));
    }

    #[test]
    fn failed_transfer_returns_everything() {
        let (_, mut r) = callback(None);
        let back = r.on_swapped(accounts(1), "usdc.near".parse().unwrap(), U128(1_000_000), U128(2_000), U128(998_000), Err(PromiseError::Failed));
        assert_eq!(back.0, 1_000_000);
    }

    #[test]
    fn partial_use_returns_the_rest_and_the_fee() {
        let (_, mut r) = callback(Some(500_000));
        let back = r.on_swapped(accounts(1), "usdc.near".parse().unwrap(), U128(1_000_000), U128(2_000), U128(998_000), Ok(U128(500_000)));
        assert_eq!(back.0, 500_000);
    }

    #[test]
    #[should_panic(expected = "Owner only")]
    fn withdraw_is_owner_only() {
        let (mut ctx, mut r) = setup();
        testing_env!(ctx.predecessor_account_id(accounts(1)).build());
        let _ = r.withdraw("usdc.near".parse().unwrap(), U128(1), accounts(1));
    }
}
