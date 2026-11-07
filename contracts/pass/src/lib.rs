use near_sdk::json_types::U128;
use near_sdk::store::LookupMap;
use near_sdk::{
    env, is_promise_success, near, require, AccountId, Gas, NearToken, PanicOnDefault, Promise,
};

/// Season pass paid in NEAR. A pass unlocks the hardest Arena tiers and the daily Boss.
/// Everything paid for passes sits in a prize pool, and only the owner can pay prizes out
/// of it. That payout step is trusted, not trustless, and the README says so.
#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Pass {
    owner: AccountId,
    price: u128,
    season_ms: u64,
    pool: u128,
    sold: u64,
    expiry: LookupMap<AccountId, u64>,
}

#[near]
impl Pass {
    #[init]
    pub fn new(owner: AccountId, price: U128, season_ms: u64) -> Self {
        require!(price.0 > 0, "price must be positive");
        require!(season_ms > 0, "season length must be positive");
        Self { owner, price: price.0, season_ms, pool: 0, sold: 0, expiry: LookupMap::new(b"e".to_vec()) }
    }

    /// Attach exactly the price in NEAR. Buying again extends the pass.
    #[payable]
    pub fn buy_pass(&mut self) -> u64 {
        require!(env::attached_deposit().as_yoctonear() == self.price, "attach exactly the pass price");
        let who = env::predecessor_account_id();
        let now = env::block_timestamp_ms();
        let start = self.expiry.get(&who).copied().unwrap_or(0).max(now);
        let until = start + self.season_ms;
        self.expiry.insert(who.clone(), until);
        self.pool += self.price;
        self.sold += 1;
        env::log_str(&format!(
            "EVENT_JSON:{{\"standard\":\"nearsay_pass\",\"version\":\"1.0.0\",\"event\":\"pass_bought\",\"data\":{{\"account\":\"{}\",\"until_ms\":{}}}}}",
            who, until
        ));
        until
    }

    /// Owner pays a prize from the pool, for example to the top of the season leaderboard.
    pub fn pay_prize(&mut self, account_id: AccountId, amount: U128) -> Promise {
        require!(env::predecessor_account_id() == self.owner, "only owner");
        require!(amount.0 > 0 && amount.0 <= self.pool, "amount exceeds the prize pool");
        self.pool -= amount.0;
        Promise::new(account_id.clone())
            .transfer(NearToken::from_yoctonear(amount.0))
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(Gas::from_tgas(5))
                    .on_prize_paid(amount),
            )
    }

    /// If the prize transfer failed, put the money back in the pool.
    #[private]
    pub fn on_prize_paid(&mut self, amount: U128) {
        if !is_promise_success() {
            self.pool += amount.0;
        }
    }

    pub fn has_pass(&self, account_id: AccountId) -> bool {
        self.expiry.get(&account_id).copied().unwrap_or(0) > env::block_timestamp_ms()
    }

    pub fn pass_expiry_ms(&self, account_id: AccountId) -> u64 {
        self.expiry.get(&account_id).copied().unwrap_or(0)
    }

    pub fn get_price(&self) -> U128 {
        U128(self.price)
    }

    pub fn get_pool(&self) -> U128 {
        U128(self.pool)
    }

    pub fn passes_sold(&self) -> u64 {
        self.sold
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{accounts, VMContextBuilder};
    use near_sdk::testing_env;

    const T0: u64 = 1_000_000;
    const PRICE: u128 = 1_000_000_000_000_000_000_000_000; // 1 NEAR
    const SEASON: u64 = 7 * 24 * 3_600_000;

    fn ctx(pred: AccountId, now_ms: u64, deposit: u128) {
        testing_env!(VMContextBuilder::new()
            .predecessor_account_id(pred)
            .attached_deposit(NearToken::from_yoctonear(deposit))
            .block_timestamp(now_ms * 1_000_000)
            .build());
    }

    fn setup() -> Pass {
        ctx(accounts(0), T0, 0);
        Pass::new(accounts(0), U128(PRICE), SEASON)
    }

    #[test]
    fn buying_unlocks_a_pass_and_fills_the_pool() {
        let mut c = setup();
        ctx(accounts(1), T0, PRICE);
        let until = c.buy_pass();
        assert_eq!(until, T0 + SEASON);
        assert!(c.has_pass(accounts(1)));
        assert!(!c.has_pass(accounts(2)));
        assert_eq!(c.get_pool().0, PRICE);
        assert_eq!(c.passes_sold(), 1);
    }

    #[test]
    fn pass_expires_and_buying_again_extends_it() {
        let mut c = setup();
        ctx(accounts(1), T0, PRICE);
        c.buy_pass();
        ctx(accounts(1), T0 + SEASON + 1, 0);
        assert!(!c.has_pass(accounts(1)));
        ctx(accounts(1), T0 + 10, PRICE);
        let until = c.buy_pass();
        assert_eq!(until, T0 + SEASON + SEASON);
    }

    #[test]
    #[should_panic(expected = "attach exactly the pass price")]
    fn wrong_payment_is_rejected() {
        let mut c = setup();
        ctx(accounts(1), T0, PRICE - 1);
        c.buy_pass();
    }

    #[test]
    #[should_panic(expected = "only owner")]
    fn only_owner_pays_prizes() {
        let mut c = setup();
        ctx(accounts(1), T0, PRICE);
        c.buy_pass();
        ctx(accounts(1), T0, 0);
        let _ = c.pay_prize(accounts(1), U128(PRICE));
    }

    #[test]
    #[should_panic(expected = "amount exceeds the prize pool")]
    fn prize_cannot_exceed_the_pool() {
        let mut c = setup();
        ctx(accounts(0), T0, 0);
        let _ = c.pay_prize(accounts(1), U128(1));
    }

    #[test]
    fn prize_reduces_the_pool() {
        let mut c = setup();
        ctx(accounts(1), T0, PRICE);
        c.buy_pass();
        ctx(accounts(0), T0, 0);
        let _ = c.pay_prize(accounts(1), U128(PRICE / 2));
        assert_eq!(c.get_pool().0, PRICE / 2);
    }
}
