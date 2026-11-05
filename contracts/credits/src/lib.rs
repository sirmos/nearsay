use near_contract_standards::fungible_token::metadata::{
    FungibleTokenMetadata, FungibleTokenMetadataProvider, FT_METADATA_SPEC,
};
use near_contract_standards::fungible_token::FungibleToken;
use near_sdk::collections::LazyOption;
use near_sdk::json_types::U128;
use near_sdk::{env, near, require, AccountId, BorshStorageKey, PanicOnDefault, PromiseOrValue};

/// Max credits one account can mint per faucet call (6 decimals => 1,000 credits).
const FAUCET_MAX: u128 = 1_000_000_000;

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Token,
    Metadata,
}

/// TESTNET MOCK. Anyone can mint credits from the faucet. Never deploy to mainnet.
#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Credits {
    token: FungibleToken,
    metadata: LazyOption<FungibleTokenMetadata>,
}

#[near]
impl Credits {
    #[init]
    pub fn new() -> Self {
        let metadata = FungibleTokenMetadata {
            spec: FT_METADATA_SPEC.to_string(),
            name: "Nearsay Credits (testnet mock)".to_string(),
            symbol: "NSC".to_string(),
            icon: None,
            reference: None,
            reference_hash: None,
            decimals: 6,
        };
        Self {
            token: FungibleToken::new(StorageKey::Token),
            metadata: LazyOption::new(StorageKey::Metadata, Some(&metadata)),
        }
    }

    /// Mint credits to the caller. Registers the caller's storage automatically.
    pub fn faucet(&mut self, amount: U128) {
        require!(amount.0 > 0 && amount.0 <= FAUCET_MAX, "amount out of range");
        let who = env::predecessor_account_id();
        self.ensure_registered(&who);
        self.token.internal_deposit(&who, amount.0);
    }

    /// Register an account so it can hold credits (the escrow needs this).
    pub fn register(&mut self, account_id: AccountId) {
        self.ensure_registered(&account_id);
    }

    /// Mint to another account (handy for seeding agents in scripts).
    pub fn faucet_to(&mut self, account_id: AccountId, amount: U128) {
        require!(amount.0 > 0 && amount.0 <= FAUCET_MAX, "amount out of range");
        self.ensure_registered(&account_id);
        self.token.internal_deposit(&account_id, amount.0);
    }
}

impl Credits {
    fn ensure_registered(&mut self, id: &AccountId) {
        if !self.token.accounts.contains_key(id) {
            self.token.internal_register_account(id);
        }
    }
}

near_contract_standards::impl_fungible_token_core!(Credits, token);

#[near]
impl FungibleTokenMetadataProvider for Credits {
    fn ft_metadata(&self) -> FungibleTokenMetadata {
        self.metadata.get().unwrap()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{accounts, VMContextBuilder};
    use near_sdk::testing_env;

    #[test]
    fn faucet_mints_and_registers() {
        testing_env!(VMContextBuilder::new().predecessor_account_id(accounts(1)).build());
        let mut c = Credits::new();
        c.faucet(U128(5_000_000));
        assert_eq!(c.token.ft_balance_of(accounts(1)).0, 5_000_000);
    }

    #[test]
    #[should_panic(expected = "amount out of range")]
    fn faucet_rejects_huge_amount() {
        testing_env!(VMContextBuilder::new().predecessor_account_id(accounts(1)).build());
        let mut c = Credits::new();
        c.faucet(U128(FAUCET_MAX + 1));
    }
}
