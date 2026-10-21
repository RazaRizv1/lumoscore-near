//! A fixed-supply NEP-141 fungible token, deployed by the LumosCore factory onto `<prefix>.<factory>`.
//!
//! The whole supply is minted once, in `new`, to the account that launched it. After that:
//!   * there is no mint, burn-by-owner, pause, blacklist or upgrade method — nobody can change the supply;
//!   * the factory creates the account WITHOUT access keys, so no one can redeploy this code either.
//! That is what makes the Trade page's padlock honest: no full-access keys AND no way to mint.
//!
//! Everything else is near-contract-standards' own FungibleToken, unchanged: transfers, transfer_call,
//! storage registration (NEP-145) and metadata (NEP-148).
use near_contract_standards::fungible_token::metadata::{
    FungibleTokenMetadata, FungibleTokenMetadataProvider, FT_METADATA_SPEC,
};
use near_contract_standards::fungible_token::{
    FungibleToken, FungibleTokenCore, FungibleTokenResolver,
};
use near_contract_standards::storage_management::{
    StorageBalance, StorageBalanceBounds, StorageManagement,
};
use near_sdk::borsh::BorshSerialize;
use near_sdk::collections::LazyOption;
use near_sdk::json_types::U128;
use near_sdk::{
    env, near, require, AccountId, BorshStorageKey, NearToken, PanicOnDefault, PromiseOrValue,
};

#[derive(BorshSerialize, BorshStorageKey)]
#[borsh(crate = "near_sdk::borsh")]
enum StorageKey {
    FungibleToken,
    Metadata,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    token: FungibleToken,
    metadata: LazyOption<FungibleTokenMetadata>,
}

#[near]
impl Contract {
    /// Called once, by the factory, in the same receipt that creates and deploys this account.
    #[init]
    pub fn new(owner_id: AccountId, total_supply: U128, metadata: FungibleTokenMetadata) -> Self {
        require!(!env::state_exists(), "Already initialized");
        metadata.assert_valid();
        require!(metadata.spec == FT_METADATA_SPEC, "Wrong metadata spec");
        require!(total_supply.0 > 0, "Total supply must be positive");
        let mut this = Self {
            token: FungibleToken::new(StorageKey::FungibleToken),
            metadata: LazyOption::new(StorageKey::Metadata, Some(&metadata)),
        };
        this.token.internal_register_account(&owner_id);
        this.token.internal_deposit(&owner_id, total_supply.into());
        near_contract_standards::fungible_token::events::FtMint {
            owner_id: &owner_id,
            amount: total_supply,
            memo: Some("LumosCore launch: fixed supply"),
        }
        .emit();
        this
    }
}

#[near]
impl FungibleTokenCore for Contract {
    #[payable]
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        self.token.ft_transfer(receiver_id, amount, memo)
    }

    #[payable]
    fn ft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        amount: U128,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<U128> {
        self.token.ft_transfer_call(receiver_id, amount, memo, msg)
    }

    fn ft_total_supply(&self) -> U128 {
        self.token.ft_total_supply()
    }

    fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        self.token.ft_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenResolver for Contract {
    #[private]
    fn ft_resolve_transfer(
        &mut self,
        sender_id: AccountId,
        receiver_id: AccountId,
        amount: U128,
    ) -> U128 {
        let (used_amount, burned_amount) =
            self.token.internal_ft_resolve_transfer(&sender_id, receiver_id, amount);
        if burned_amount > 0 {
            near_contract_standards::fungible_token::events::FtBurn {
                owner_id: &sender_id,
                amount: U128(burned_amount),
                memo: Some("Unregistered receiver"),
            }
            .emit();
        }
        used_amount.into()
    }
}

#[near]
impl StorageManagement for Contract {
    #[payable]
    fn storage_deposit(
        &mut self,
        account_id: Option<AccountId>,
        registration_only: Option<bool>,
    ) -> StorageBalance {
        self.token.storage_deposit(account_id, registration_only)
    }

    #[payable]
    fn storage_withdraw(&mut self, amount: Option<NearToken>) -> StorageBalance {
        self.token.storage_withdraw(amount)
    }

    #[payable]
    fn storage_unregister(&mut self, force: Option<bool>) -> bool {
        #[allow(unused_variables)]
        if let Some((account_id, balance)) = self.token.internal_storage_unregister(force) {
            near_contract_standards::fungible_token::events::FtBurn {
                owner_id: &account_id,
                amount: balance.into(),
                memo: Some("Account unregistered"),
            }
            .emit();
            true
        } else {
            false
        }
    }

    fn storage_balance_bounds(&self) -> StorageBalanceBounds {
        self.token.storage_balance_bounds()
    }

    fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        self.token.storage_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenMetadataProvider for Contract {
    fn ft_metadata(&self) -> FungibleTokenMetadata {
        self.metadata.get().unwrap()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{accounts, VMContextBuilder};
    use near_sdk::testing_env;

    fn meta() -> FungibleTokenMetadata {
        FungibleTokenMetadata {
            spec: FT_METADATA_SPEC.to_string(),
            name: "Solar Flare".to_string(),
            symbol: "FLARE".to_string(),
            icon: None,
            reference: None,
            reference_hash: None,
            decimals: 18,
        }
    }

    #[test]
    fn whole_supply_goes_to_the_launcher() {
        testing_env!(VMContextBuilder::new().current_account_id(accounts(0)).build());
        let c = Contract::new(accounts(1), U128(1_000_000), meta());
        assert_eq!(c.ft_total_supply().0, 1_000_000);
        assert_eq!(c.ft_balance_of(accounts(1)).0, 1_000_000);
        assert_eq!(c.ft_balance_of(accounts(2)).0, 0);
        assert_eq!(c.ft_metadata().symbol, "FLARE");
    }

    #[test]
    #[should_panic(expected = "Total supply must be positive")]
    fn zero_supply_is_refused() {
        testing_env!(VMContextBuilder::new().current_account_id(accounts(0)).build());
        Contract::new(accounts(1), U128(0), meta());
    }

    #[test]
    fn transfer_moves_balance_and_supply_is_unchanged() {
        let mut ctx = VMContextBuilder::new();
        ctx.current_account_id(accounts(0));
        testing_env!(ctx.build());
        let mut c = Contract::new(accounts(1), U128(1_000), meta());
        let min = c.storage_balance_bounds().min;
        testing_env!(ctx.predecessor_account_id(accounts(2)).attached_deposit(min).build());
        c.storage_deposit(None, None);
        testing_env!(ctx
            .predecessor_account_id(accounts(1))
            .attached_deposit(NearToken::from_yoctonear(1))
            .build());
        c.ft_transfer(accounts(2), U128(250), None);
        assert_eq!(c.ft_balance_of(accounts(1)).0, 750);
        assert_eq!(c.ft_balance_of(accounts(2)).0, 250);
        assert_eq!(c.ft_total_supply().0, 1_000);
    }
}
