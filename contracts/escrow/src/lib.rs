use near_sdk::json_types::U128;
use near_sdk::store::LookupMap;
use near_sdk::{
    env, ext_contract, is_promise_success, near, require, AccountId, Gas, NearToken,
    PanicOnDefault, Promise, PromiseOrValue,
};

#[ext_contract(ext_ft)]
pub trait FungibleToken {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
}

#[near(serializers = [json, borsh])]
#[derive(Clone, PartialEq, Debug)]
pub enum JobStatus {
    Open,
    Funded,
    Submitted,
    Settled,
    Refunded,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Job {
    pub id: u64,
    pub buyer: AccountId,
    pub seller: AccountId,
    pub token: AccountId,
    pub amount: U128,
    pub spec_hash: String,
    pub deadline_ms: u64,
    pub status: JobStatus,
    pub result_hash: Option<String>,
    pub evidence_ref: Option<String>,
}

/// Verdict produced by the off-chain verifier. Evidence fields are stored in the
/// settlement log so anyone can audit what the verifier checked.
#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct Verdict {
    pub job_id: u64,
    pub result_hash: String,
    pub ok: bool,
    pub model_id: String,
    pub signature_kind: String,
    pub signing_address: String,
    pub attestation_hash: String,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Reputation {
    pub settled_jobs: u64,
    pub score: U128,
}

impl Default for Reputation {
    fn default() -> Self {
        Reputation { settled_jobs: 0, score: U128(0) }
    }
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Escrow {
    owner: AccountId,
    verifier: AccountId,
    accepted_kinds: Vec<String>,
    fee_bps: u32,
    pair_cap: u128,
    next_job_id: u64,
    jobs: LookupMap<u64, Job>,
    reputation: LookupMap<AccountId, Reputation>,
    pair_totals: LookupMap<String, u128>,
    fees: LookupMap<AccountId, u128>,
    /// Money owed to an account because a token transfer failed. Pulled with `withdraw`.
    withdrawable: LookupMap<String, u128>,
}

#[near]
impl Escrow {
    #[init]
    pub fn new(
        owner: AccountId,
        verifier: AccountId,
        accepted_kinds: Vec<String>,
        fee_bps: u32,
        pair_cap: U128,
    ) -> Self {
        require!(fee_bps <= 1_000, "fee too high (max 10%)");
        Self {
            owner,
            verifier,
            accepted_kinds,
            fee_bps,
            pair_cap: pair_cap.0,
            next_job_id: 1,
            jobs: LookupMap::new(b"j".to_vec()),
            reputation: LookupMap::new(b"r".to_vec()),
            pair_totals: LookupMap::new(b"p".to_vec()),
            fees: LookupMap::new(b"f".to_vec()),
            withdrawable: LookupMap::new(b"w".to_vec()),
        }
    }

    /// Buyer creates a job. Then funds it with ft_transfer_call(msg = job id).
    pub fn create_job(
        &mut self,
        seller: AccountId,
        token: AccountId,
        amount: U128,
        spec_hash: String,
        deadline_ms: u64,
    ) -> u64 {
        let buyer = env::predecessor_account_id();
        require!(amount.0 > 0, "amount must be positive");
        require!(seller != buyer, "seller cannot be the buyer");
        require!(deadline_ms > env::block_timestamp_ms(), "deadline in the past");
        let id = self.next_job_id;
        self.next_job_id += 1;
        let job = Job {
            id,
            buyer,
            seller,
            token,
            amount,
            spec_hash,
            deadline_ms,
            status: JobStatus::Open,
            result_hash: None,
            evidence_ref: None,
        };
        self.jobs.insert(id, job);
        Self::log("job_created", id);
        id
    }

    /// NEP-141 receiver. Called by the token contract when the buyer funds a job.
    pub fn ft_on_transfer(
        &mut self,
        sender_id: AccountId,
        amount: U128,
        msg: String,
    ) -> PromiseOrValue<U128> {
        let token = env::predecessor_account_id();
        let job_id: u64 = msg
            .trim()
            .parse()
            .unwrap_or_else(|_| env::panic_str("msg must be a job id"));
        let mut job = self.load(job_id);
        require!(job.status == JobStatus::Open, "job not open");
        require!(token == job.token, "wrong token");
        require!(sender_id == job.buyer, "sender is not the buyer");
        require!(amount == job.amount, "wrong amount");
        job.status = JobStatus::Funded;
        self.jobs.insert(job_id, job);
        Self::log("job_funded", job_id);
        PromiseOrValue::Value(U128(0))
    }

    pub fn submit_result(&mut self, job_id: u64, result_hash: String, evidence_ref: String) {
        let mut job = self.load(job_id);
        require!(env::predecessor_account_id() == job.seller, "only the seller");
        require!(job.status == JobStatus::Funded, "job not funded");
        require!(env::block_timestamp_ms() <= job.deadline_ms, "deadline passed");
        job.status = JobStatus::Submitted;
        job.result_hash = Some(result_hash);
        job.evidence_ref = Some(evidence_ref);
        self.jobs.insert(job_id, job);
        Self::log("result_submitted", job_id);
    }

    /// Only the verifier can settle. Pays the seller if the verdict is ok and the
    /// signature kind is accepted. Otherwise refunds the buyer.
    pub fn settle(&mut self, job_id: u64, verdict: Verdict) -> Promise {
        require!(env::predecessor_account_id() == self.verifier, "only verifier");
        let mut job = self.load(job_id);
        require!(job.status == JobStatus::Submitted, "job not submitted");
        require!(verdict.job_id == job_id, "verdict job mismatch");
        require!(
            Some(&verdict.result_hash) == job.result_hash.as_ref(),
            "result hash mismatch"
        );
        let amount = job.amount.0;
        let accepted = verdict.ok && self.accepted_kinds.contains(&verdict.signature_kind);
        if accepted {
            let fee = amount.checked_mul(self.fee_bps as u128).expect("overflow") / 10_000;
            let payout = amount - fee;
            job.status = JobStatus::Settled;
            self.jobs.insert(job_id, job.clone());
            let prev = self.fees.get(&job.token).copied().unwrap_or(0);
            self.fees.insert(job.token.clone(), prev + fee);
            self.record_reputation(&job.seller, &job.buyer, amount);
            Self::log("settled", job_id);
            Self::pay_safe(&job.token, &job.seller, payout, "nearsay settle")
        } else {
            job.status = JobStatus::Refunded;
            self.jobs.insert(job_id, job.clone());
            Self::log("refunded_unverified", job_id);
            Self::pay_safe(&job.token, &job.buyer, amount, "nearsay refund")
        }
    }

    /// Anyone can trigger a refund once the deadline has passed without settlement.
    pub fn refund(&mut self, job_id: u64) -> Promise {
        let mut job = self.load(job_id);
        require!(
            job.status == JobStatus::Funded || job.status == JobStatus::Submitted,
            "nothing to refund"
        );
        require!(env::block_timestamp_ms() > job.deadline_ms, "deadline not reached");
        job.status = JobStatus::Refunded;
        self.jobs.insert(job_id, job.clone());
        Self::log("refunded_deadline", job_id);
        Self::pay_safe(&job.token, &job.buyer, job.amount.0, "nearsay refund")
    }

    pub fn claim_fees(&mut self, token: AccountId) -> Promise {
        require!(env::predecessor_account_id() == self.owner, "only owner");
        let amount = self.fees.get(&token).copied().unwrap_or(0);
        require!(amount > 0, "no fees");
        self.fees.insert(token.clone(), 0);
        Self::pay_safe(&token, &self.owner, amount, "nearsay fees")
    }

    /// Callback after every token transfer. If the transfer failed, the money is not lost:
    /// it is credited to the recipient, who can pull it later with `withdraw`.
    #[private]
    pub fn on_paid(&mut self, token: AccountId, to: AccountId, amount: U128) {
        if !is_promise_success() {
            self.restore(&token, &to, amount.0);
        }
    }

    /// Pull money that a failed transfer left owed to the caller.
    pub fn withdraw(&mut self, token: AccountId) -> Promise {
        let who = env::predecessor_account_id();
        let key = Self::wkey(&token, &who);
        let amount = self.withdrawable.get(&key).copied().unwrap_or(0);
        require!(amount > 0, "nothing to withdraw");
        self.withdrawable.insert(key, 0);
        Self::pay_safe(&token, &who, amount, "nearsay withdraw")
    }

    pub fn get_withdrawable(&self, token: AccountId, account_id: AccountId) -> U128 {
        U128(self.withdrawable.get(&Self::wkey(&token, &account_id)).copied().unwrap_or(0))
    }

    pub fn set_verifier(&mut self, verifier: AccountId) {
        require!(env::predecessor_account_id() == self.owner, "only owner");
        self.verifier = verifier;
    }

    pub fn get_job(&self, job_id: u64) -> Option<Job> {
        self.jobs.get(&job_id).cloned()
    }

    pub fn get_reputation(&self, account_id: AccountId) -> Reputation {
        self.reputation.get(&account_id).cloned().unwrap_or_default()
    }

    pub fn accrued_fees(&self, token: AccountId) -> U128 {
        U128(self.fees.get(&token).copied().unwrap_or(0))
    }

    pub fn get_verifier(&self) -> AccountId {
        self.verifier.clone()
    }
}

impl Escrow {
    fn load(&self, job_id: u64) -> Job {
        self.jobs
            .get(&job_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("no such job"))
    }

    fn wkey(token: &AccountId, who: &AccountId) -> String {
        format!("{}|{}", token, who)
    }

    fn restore(&mut self, token: &AccountId, to: &AccountId, amount: u128) {
        let key = Self::wkey(token, to);
        let prev = self.withdrawable.get(&key).copied().unwrap_or(0);
        self.withdrawable.insert(key, prev + amount);
        env::log_str(&format!(
            "EVENT_JSON:{{\"standard\":\"nearsay\",\"version\":\"1.0.0\",\"event\":\"transfer_failed_credited\",\"data\":{{\"to\":\"{}\",\"amount\":\"{}\"}}}}",
            to, amount
        ));
    }

    /// Transfer, then check the result. A failed transfer is credited back, never lost.
    fn pay_safe(token: &AccountId, to: &AccountId, amount: u128, memo: &str) -> Promise {
        Self::pay(token, to, amount, memo).then(
            Self::ext(env::current_account_id())
                .with_static_gas(Gas::from_tgas(10))
                .on_paid(token.clone(), to.clone(), U128(amount)),
        )
    }

    fn pay(token: &AccountId, to: &AccountId, amount: u128, memo: &str) -> Promise {
        ext_ft::ext(token.clone())
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(Gas::from_tgas(15))
            .ft_transfer(to.clone(), U128(amount), Some(memo.to_string()))
    }

    fn record_reputation(&mut self, seller: &AccountId, buyer: &AccountId, amount: u128) {
        let key = format!("{}|{}", seller, buyer);
        let used = self.pair_totals.get(&key).copied().unwrap_or(0);
        let room = self.pair_cap.saturating_sub(used);
        let counted = amount.min(room);
        self.pair_totals.insert(key, used + counted);
        let mut rep = self.reputation.get(seller).cloned().unwrap_or_default();
        rep.settled_jobs += 1;
        rep.score = U128(rep.score.0 + counted);
        self.reputation.insert(seller.clone(), rep);
    }

    fn log(event: &str, job_id: u64) {
        env::log_str(&format!(
            "EVENT_JSON:{{\"standard\":\"nearsay\",\"version\":\"1.0.0\",\"event\":\"{}\",\"data\":{{\"job_id\":{}}}}}",
            event, job_id
        ));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{accounts, VMContextBuilder};
    use near_sdk::testing_env;

    const T0: u64 = 1_000_000; // ms

    fn ctx(pred: AccountId, now_ms: u64) {
        testing_env!(VMContextBuilder::new()
            .predecessor_account_id(pred)
            .block_timestamp(now_ms * 1_000_000)
            .build());
    }

    // accounts: 0 owner, 1 buyer, 2 seller, 3 verifier, 4 token
    fn setup_cap(cap: u128) -> Escrow {
        ctx(accounts(0), T0);
        Escrow::new(
            accounts(0),
            accounts(3),
            vec!["provider_tee".to_string()],
            100,
            U128(cap),
        )
    }

    fn setup() -> Escrow {
        setup_cap(1_000_000)
    }

    fn funded_and_submitted(c: &mut Escrow, amount: u128) -> u64 {
        ctx(accounts(1), T0);
        let id = c.create_job(
            accounts(2),
            accounts(4),
            U128(amount),
            "spec".to_string(),
            T0 + 10_000,
        );
        ctx(accounts(4), T0);
        let _ = c.ft_on_transfer(accounts(1), U128(amount), id.to_string());
        ctx(accounts(2), T0 + 1);
        c.submit_result(id, "hash1".to_string(), "evidence".to_string());
        id
    }

    fn verdict(id: u64, ok: bool, kind: &str) -> Verdict {
        Verdict {
            job_id: id,
            result_hash: "hash1".to_string(),
            ok,
            model_id: "z-ai/glm-5.3-flash".to_string(),
            signature_kind: kind.to_string(),
            signing_address: "0xabc".to_string(),
            attestation_hash: "att".to_string(),
        }
    }

    #[test]
    fn settles_and_records_reputation() {
        let mut c = setup();
        let id = funded_and_submitted(&mut c, 1_000);
        ctx(accounts(3), T0 + 2);
        let _ = c.settle(id, verdict(id, true, "provider_tee"));
        assert_eq!(c.get_job(id).unwrap().status, JobStatus::Settled);
        let r = c.get_reputation(accounts(2));
        assert_eq!(r.settled_jobs, 1);
        assert_eq!(r.score.0, 1_000);
        assert_eq!(c.accrued_fees(accounts(4)).0, 10);
    }

    #[test]
    fn unaccepted_signature_kind_refunds_and_gives_no_reputation() {
        let mut c = setup();
        let id = funded_and_submitted(&mut c, 1_000);
        ctx(accounts(3), T0 + 2);
        let _ = c.settle(id, verdict(id, true, "gateway"));
        assert_eq!(c.get_job(id).unwrap().status, JobStatus::Refunded);
        assert_eq!(c.get_reputation(accounts(2)).settled_jobs, 0);
    }

    #[test]
    #[should_panic(expected = "only verifier")]
    fn only_verifier_can_settle() {
        let mut c = setup();
        let id = funded_and_submitted(&mut c, 1_000);
        ctx(accounts(1), T0 + 2);
        let _ = c.settle(id, verdict(id, true, "provider_tee"));
    }

    #[test]
    #[should_panic(expected = "result hash mismatch")]
    fn mismatched_result_hash_is_rejected() {
        let mut c = setup();
        let id = funded_and_submitted(&mut c, 1_000);
        ctx(accounts(3), T0 + 2);
        let mut v = verdict(id, true, "provider_tee");
        v.result_hash = "other".to_string();
        let _ = c.settle(id, v);
    }

    #[test]
    #[should_panic(expected = "deadline not reached")]
    fn refund_before_deadline_is_rejected() {
        let mut c = setup();
        let id = funded_and_submitted(&mut c, 1_000);
        ctx(accounts(1), T0 + 5);
        let _ = c.refund(id);
    }

    #[test]
    fn refund_after_deadline_works() {
        let mut c = setup();
        let id = funded_and_submitted(&mut c, 1_000);
        ctx(accounts(1), T0 + 10_001);
        let _ = c.refund(id);
        assert_eq!(c.get_job(id).unwrap().status, JobStatus::Refunded);
    }

    #[test]
    fn failed_transfer_is_credited_and_can_be_withdrawn() {
        let mut c = setup();
        // A transfer of 990 to the seller failed: the callback logic credits it.
        c.restore(&accounts(4), &accounts(2), 990);
        assert_eq!(c.get_withdrawable(accounts(4), accounts(2)).0, 990);
        ctx(accounts(2), T0 + 3);
        let _ = c.withdraw(accounts(4));
        assert_eq!(c.get_withdrawable(accounts(4), accounts(2)).0, 0);
    }

    #[test]
    #[should_panic(expected = "nothing to withdraw")]
    fn withdraw_with_nothing_owed_is_rejected() {
        let mut c = setup();
        ctx(accounts(2), T0);
        let _ = c.withdraw(accounts(4));
    }

    #[test]
    fn claim_fees_zeroes_the_ledger_and_failure_restores_it() {
        let mut c = setup();
        let id = funded_and_submitted(&mut c, 1_000);
        ctx(accounts(3), T0 + 2);
        let _ = c.settle(id, verdict(id, true, "provider_tee"));
        ctx(accounts(0), T0 + 3);
        let _ = c.claim_fees(accounts(4));
        assert_eq!(c.accrued_fees(accounts(4)).0, 0);
        // The fee transfer failed: the owner can still pull it.
        c.restore(&accounts(4), &accounts(0), 10);
        assert_eq!(c.get_withdrawable(accounts(4), accounts(0)).0, 10);
    }

    #[test]
    fn pair_cap_limits_reputation() {
        let mut c = setup_cap(1_500);
        for _ in 0..2 {
            let id = funded_and_submitted(&mut c, 1_000);
            ctx(accounts(3), T0 + 2);
            let _ = c.settle(id, verdict(id, true, "provider_tee"));
        }
        let r = c.get_reputation(accounts(2));
        assert_eq!(r.settled_jobs, 2);
        assert_eq!(r.score.0, 1_500);
    }
}
