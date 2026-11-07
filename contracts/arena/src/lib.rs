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
pub enum RoundStatus {
    Open,
    Settled,
    Voided,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Guess {
    pub player: AccountId,
    pub choice: u32,
}

/// Evidence supplied by the verifier at reveal. Stored for audit.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Evidence {
    pub ok: bool,
    pub model_id: String,
    pub signature_kind: String,
    pub signing_address: String,
    pub attestation_hash: String,
    pub response_hash: String,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Round {
    pub id: u64,
    pub question: String,
    pub token: AccountId,
    pub stake: U128,
    pub answers: Vec<String>,
    pub commit: String,
    pub closes_ms: u64,
    pub status: RoundStatus,
    pub guesses: Vec<Guess>,
    pub real_index: Option<u32>,
    pub evidence: Option<Evidence>,
    /// Who wrote each answer (None for the real one). Filled in at reveal, so the
    /// liar leaderboard can be rebuilt from the chain.
    pub authors: Vec<Option<AccountId>>,
    /// Optional prize added by a sponsor. Goes to the players who guessed right.
    pub sponsor: Option<AccountId>,
    pub bonus: U128,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Arena {
    owner: AccountId,
    dealer: AccountId,
    accepted_kinds: Vec<String>,
    fee_bps: u32,
    liar_bps: u32,
    max_guessers: u32,
    grace_ms: u64,
    next_round_id: u64,
    rounds: LookupMap<u64, Round>,
    claimable: LookupMap<String, u128>,
}

#[near]
impl Arena {
    #[init]
    pub fn new(
        owner: AccountId,
        dealer: AccountId,
        accepted_kinds: Vec<String>,
        fee_bps: u32,
        liar_bps: u32,
        max_guessers: u32,
        grace_ms: u64,
    ) -> Self {
        require!(fee_bps <= 1_000, "fee too high (max 10%)");
        require!(liar_bps <= 5_000, "liar share too high (max 50%)");
        Self {
            owner,
            dealer,
            accepted_kinds,
            fee_bps,
            liar_bps,
            max_guessers,
            grace_ms,
            next_round_id: 1,
            rounds: LookupMap::new(b"r".to_vec()),
            claimable: LookupMap::new(b"c".to_vec()),
        }
    }

    /// Dealer opens a round. `answers` are already shuffled and include the real one.
    /// `commit` = hex(sha256("<real_index>:<salt>")).
    pub fn create_round(
        &mut self,
        question: String,
        token: AccountId,
        stake: U128,
        answers: Vec<String>,
        commit: String,
        closes_ms: u64,
    ) -> u64 {
        require!(env::predecessor_account_id() == self.dealer, "only dealer");
        require!(stake.0 > 0, "stake must be positive");
        require!(answers.len() >= 2 && answers.len() <= 6, "2 to 6 answers");
        require!(commit.len() == 64, "commit must be 64 hex chars");
        require!(closes_ms > env::block_timestamp_ms(), "close time in the past");
        let id = self.next_round_id;
        self.next_round_id += 1;
        let round = Round {
            id,
            question,
            token,
            stake,
            answers,
            commit,
            closes_ms,
            status: RoundStatus::Open,
            guesses: vec![],
            real_index: None,
            evidence: None,
            authors: vec![],
            sponsor: None,
            bonus: U128(0),
        };
        self.rounds.insert(id, round);
        Self::log("round_created", id);
        id
    }

    /// NEP-141 receiver. msg = "<round_id>:<choice_index>".
    pub fn ft_on_transfer(
        &mut self,
        sender_id: AccountId,
        amount: U128,
        msg: String,
    ) -> PromiseOrValue<U128> {
        let token = env::predecessor_account_id();
        // msg "S:<round_id>" = a sponsor adds a prize to an open round.
        if let Some(rest) = msg.trim().strip_prefix("S:") {
            return self.sponsor_round(token, sender_id, amount, rest);
        }
        let (rid, choice) = msg
            .trim()
            .split_once(':')
            .unwrap_or_else(|| env::panic_str("msg must be round_id:choice"));
        let round_id: u64 = rid.parse().unwrap_or_else(|_| env::panic_str("bad round id"));
        let choice: u32 = choice.parse().unwrap_or_else(|_| env::panic_str("bad choice"));
        let mut round = self.load(round_id);
        require!(round.status == RoundStatus::Open, "round not open");
        require!(token == round.token, "wrong token");
        require!(amount == round.stake, "wrong stake");
        require!(env::block_timestamp_ms() < round.closes_ms, "guessing closed");
        require!(sender_id != self.dealer, "dealer cannot play");
        require!((choice as usize) < round.answers.len(), "no such answer");
        require!(
            !round.guesses.iter().any(|g| g.player == sender_id),
            "already guessed"
        );
        require!(
            (round.guesses.len() as u32) < self.max_guessers,
            "round is full"
        );
        round.guesses.push(Guess { player: sender_id, choice });
        self.rounds.insert(round_id, round);
        Self::log("guess_placed", round_id);
        PromiseOrValue::Value(U128(0))
    }

    /// Dealer reveals after the deadline. `authors[i]` is the liar who wrote answer i
    /// (None for the real answer and for any unattributed decoy).
    pub fn reveal(
        &mut self,
        round_id: u64,
        real_index: u32,
        salt: String,
        authors: Vec<Option<AccountId>>,
        evidence: Evidence,
    ) {
        require!(env::predecessor_account_id() == self.dealer, "only dealer");
        let mut round = self.load(round_id);
        require!(round.status == RoundStatus::Open, "round not open");
        require!(env::block_timestamp_ms() >= round.closes_ms, "guessing still open");
        require!(authors.len() == round.answers.len(), "authors length mismatch");
        require!((real_index as usize) < round.answers.len(), "bad index");
        require!(authors[real_index as usize].is_none(), "real answer has no author");
        let expected = Self::hex_sha256(format!("{}:{}", real_index, salt).as_bytes());
        require!(expected == round.commit, "commit mismatch");

        round.evidence = Some(evidence.clone());
        round.authors = authors.clone();
        let accepted = evidence.ok && self.accepted_kinds.contains(&evidence.signature_kind);
        if !accepted {
            self.refund_all(&round);
            round.status = RoundStatus::Voided;
            self.rounds.insert(round_id, round);
            Self::log("round_voided_evidence", round_id);
            return;
        }
        self.pay_out(&round, real_index, &authors);
        self.pay_bonus(&round, real_index, &authors);
        round.real_index = Some(real_index);
        round.status = RoundStatus::Settled;
        self.rounds.insert(round_id, round);
        Self::log("round_settled", round_id);
    }

    /// Anyone can void a stuck round after the grace period; everyone is refunded.
    pub fn void_round(&mut self, round_id: u64) {
        let mut round = self.load(round_id);
        require!(round.status == RoundStatus::Open, "round not open");
        require!(
            env::block_timestamp_ms() > round.closes_ms + self.grace_ms,
            "grace period not over"
        );
        self.refund_all(&round);
        round.status = RoundStatus::Voided;
        self.rounds.insert(round_id, round);
        Self::log("round_voided_timeout", round_id);
    }

    /// Withdraw everything credited to the caller in `token`.
    pub fn claim(&mut self, token: AccountId) -> Promise {
        let who = env::predecessor_account_id();
        let key = Self::key(&token, &who);
        let amount = self.claimable.get(&key).copied().unwrap_or(0);
        require!(amount > 0, "nothing to claim");
        self.claimable.insert(key, 0);
        Self::pay(&token, &who, amount).then(
            Self::ext(env::current_account_id())
                .with_static_gas(Gas::from_tgas(10))
                .on_claim_paid(token.clone(), who, U128(amount)),
        )
    }

    /// Callback after a claim transfer. If it failed, the money goes back on the
    /// player's claimable balance, so a failed transfer never loses a payout.
    #[private]
    pub fn on_claim_paid(&mut self, token: AccountId, who: AccountId, amount: U128) {
        if !is_promise_success() {
            self.credit(&token, &who, amount.0);
        }
    }

    pub fn get_round(&self, round_id: u64) -> Option<Round> {
        self.rounds.get(&round_id).cloned()
    }

    pub fn get_claimable(&self, token: AccountId, account_id: AccountId) -> U128 {
        U128(self.claimable.get(&Self::key(&token, &account_id)).copied().unwrap_or(0))
    }

    pub fn get_dealer(&self) -> AccountId {
        self.dealer.clone()
    }
}

impl Arena {
    fn load(&self, round_id: u64) -> Round {
        self.rounds
            .get(&round_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("no such round"))
    }

    fn key(token: &AccountId, who: &AccountId) -> String {
        format!("{}|{}", token, who)
    }

    fn hex_sha256(bytes: &[u8]) -> String {
        env::sha256(bytes).iter().map(|b| format!("{:02x}", b)).collect()
    }

    fn credit(&mut self, token: &AccountId, who: &AccountId, amount: u128) {
        if amount == 0 {
            return;
        }
        let key = Self::key(token, who);
        let prev = self.claimable.get(&key).copied().unwrap_or(0);
        self.claimable.insert(key, prev + amount);
    }

    fn refund_all(&mut self, round: &Round) {
        for g in &round.guesses {
            self.credit(&round.token, &g.player, round.stake.0);
        }
        if let Some(s) = &round.sponsor {
            self.credit(&round.token, s, round.bonus.0);
        }
    }

    /// A sponsor adds a prize to an open round. One sponsor per round.
    fn sponsor_round(
        &mut self,
        token: AccountId,
        sponsor: AccountId,
        amount: U128,
        rid: &str,
    ) -> PromiseOrValue<U128> {
        let round_id: u64 = rid.parse().unwrap_or_else(|_| env::panic_str("bad round id"));
        let mut round = self.load(round_id);
        require!(round.status == RoundStatus::Open, "round not open");
        require!(token == round.token, "wrong token");
        require!(amount.0 > 0, "prize must be positive");
        require!(env::block_timestamp_ms() < round.closes_ms, "guessing closed");
        require!(round.sponsor.is_none(), "already sponsored");
        round.sponsor = Some(sponsor);
        round.bonus = amount;
        self.rounds.insert(round_id, round);
        Self::log("round_sponsored", round_id);
        PromiseOrValue::Value(U128(0))
    }

    /// Split the sponsor's prize equally among the correct guessers. If nobody was
    /// right, the sponsor gets it back. Rounding dust also goes back to the sponsor.
    fn pay_bonus(&mut self, round: &Round, real: u32, authors: &[Option<AccountId>]) {
        let Some(sponsor) = round.sponsor.clone() else { return };
        let bonus = round.bonus.0;
        if bonus == 0 {
            return;
        }
        let winners: Vec<AccountId> = round
            .guesses
            .iter()
            .filter(|g| g.choice == real && !authors.iter().flatten().any(|a| a == &g.player))
            .map(|g| g.player.clone())
            .collect();
        if winners.is_empty() {
            self.credit(&round.token, &sponsor, bonus);
            return;
        }
        let share = bonus / winners.len() as u128;
        for w in &winners {
            self.credit(&round.token, w, share);
        }
        self.credit(&round.token, &sponsor, bonus - share * winners.len() as u128);
    }

    fn pay_out(&mut self, round: &Round, real: u32, authors: &[Option<AccountId>]) {
        let stake = round.stake.0;
        let owner = self.owner.clone();

        // Liars who guess in their own round get their stake back and are not counted.
        let author_set: Vec<&AccountId> = authors.iter().flatten().collect();
        let mut valid: Vec<&Guess> = vec![];
        for g in &round.guesses {
            if author_set.contains(&&g.player) {
                self.credit(&round.token, &g.player, stake);
            } else {
                valid.push(g);
            }
        }
        if valid.is_empty() {
            return;
        }

        let total = stake * valid.len() as u128;
        let fee = total * self.fee_bps as u128 / 10_000;
        let net = total - fee;

        let winners: Vec<&AccountId> = valid
            .iter()
            .filter(|g| g.choice == real)
            .map(|g| &g.player)
            .collect();

        // How many guessers each liar fooled.
        let mut fooled: Vec<(AccountId, u128)> = vec![];
        for g in valid.iter().filter(|g| g.choice != real) {
            if let Some(a) = &authors[g.choice as usize] {
                match fooled.iter_mut().find(|(who, _)| who == a) {
                    Some(entry) => entry.1 += 1,
                    None => fooled.push((a.clone(), 1)),
                }
            }
        }
        let total_fooled: u128 = fooled.iter().map(|(_, c)| *c).sum();

        if winners.is_empty() && total_fooled == 0 {
            // Nobody right and nobody fooled by an attributed liar: refund everyone.
            for g in &valid {
                self.credit(&round.token, &g.player, stake);
            }
            return;
        }

        let (winner_pool, liar_pool) = if winners.is_empty() {
            (0, net)
        } else if total_fooled == 0 {
            (net, 0)
        } else {
            let lp = net * self.liar_bps as u128 / 10_000;
            (net - lp, lp)
        };

        let mut credited: u128 = 0;
        if !winners.is_empty() {
            let share = winner_pool / winners.len() as u128;
            for w in &winners {
                self.credit(&round.token, w, share);
                credited += share;
            }
        }
        for (who, count) in &fooled {
            let share = liar_pool * count / total_fooled;
            self.credit(&round.token, who, share);
            credited += share;
        }
        // Fee plus any rounding dust goes to the owner.
        self.credit(&round.token, &owner, total - credited);
    }

    fn pay(token: &AccountId, to: &AccountId, amount: u128) -> Promise {
        ext_ft::ext(token.clone())
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(Gas::from_tgas(15))
            .ft_transfer(to.clone(), U128(amount), Some("nearsay arena".to_string()))
    }

    fn log(event: &str, round_id: u64) {
        env::log_str(&format!(
            "EVENT_JSON:{{\"standard\":\"nearsay_arena\",\"version\":\"1.0.0\",\"event\":\"{}\",\"data\":{{\"round_id\":{}}}}}",
            event, round_id
        ));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{accounts, VMContextBuilder};
    use near_sdk::testing_env;

    const T0: u64 = 1_000_000;
    const CLOSE: u64 = T0 + 10_000;
    const STAKE: u128 = 1_000;

    // accounts: 0 owner, 1 dealer, 2 player one, 3 player two, 4 token, 5 liar
    fn ctx(pred: AccountId, now_ms: u64) {
        testing_env!(VMContextBuilder::new()
            .predecessor_account_id(pred)
            .block_timestamp(now_ms * 1_000_000)
            .build());
    }

    fn setup() -> Arena {
        ctx(accounts(0), T0);
        Arena::new(accounts(0), accounts(1), vec!["provider_tee".to_string()], 100, 2000, 10, 3_600_000)
    }

    // real answer is index 1, salt "salt"
    fn open_round(c: &mut Arena) -> u64 {
        ctx(accounts(1), T0);
        let commit = Arena::hex_sha256(b"1:salt");
        c.create_round(
            "Name a river".to_string(),
            accounts(4),
            U128(STAKE),
            vec!["a".to_string(), "b".to_string(), "c".to_string()],
            commit,
            CLOSE,
        )
    }

    fn guess(c: &mut Arena, who: AccountId, id: u64, choice: u32, now: u64) {
        ctx(accounts(4), now);
        let _ = c.ft_on_transfer(who, U128(STAKE), format!("{}:{}", id, choice));
    }

    fn evidence(ok: bool, kind: &str) -> Evidence {
        Evidence {
            ok,
            model_id: "z-ai/glm-5.3-flash".to_string(),
            signature_kind: kind.to_string(),
            signing_address: "0xabc".to_string(),
            attestation_hash: "att".to_string(),
            response_hash: "resp".to_string(),
        }
    }

    fn authors_liar() -> Vec<Option<AccountId>> {
        vec![None, None, Some(accounts(5))]
    }

    fn reveal_ok(c: &mut Arena, id: u64) {
        ctx(accounts(1), CLOSE);
        c.reveal(id, 1, "salt".to_string(), authors_liar(), evidence(true, "provider_tee"));
    }

    fn bal(c: &Arena, who: AccountId) -> u128 {
        c.get_claimable(accounts(4), who).0
    }

    #[test]
    fn winner_and_liar_split() {
        let mut c = setup();
        let id = open_round(&mut c);
        guess(&mut c, accounts(2), id, 1, T0 + 1); // right
        guess(&mut c, accounts(3), id, 2, T0 + 2); // fooled by the liar
        reveal_ok(&mut c, id);
        // total 2000, fee 20, net 1980, liar pool 396, winner pool 1584
        assert_eq!(bal(&c, accounts(2)), 1_584);
        assert_eq!(bal(&c, accounts(5)), 396);
        assert_eq!(bal(&c, accounts(0)), 20);
        assert_eq!(bal(&c, accounts(3)), 0);
        assert_eq!(c.get_round(id).unwrap().status, RoundStatus::Settled);
    }

    #[test]
    fn no_winner_pays_liars() {
        let mut c = setup();
        let id = open_round(&mut c);
        guess(&mut c, accounts(2), id, 0, T0 + 1); // unattributed decoy
        guess(&mut c, accounts(3), id, 2, T0 + 2); // liar's decoy
        reveal_ok(&mut c, id);
        assert_eq!(bal(&c, accounts(5)), 1_980);
        assert_eq!(bal(&c, accounts(0)), 20);
    }

    #[test]
    fn author_guess_is_refunded_and_not_counted() {
        let mut c = setup();
        let id = open_round(&mut c);
        guess(&mut c, accounts(5), id, 2, T0 + 1); // liar guesses own decoy
        guess(&mut c, accounts(2), id, 1, T0 + 2);
        reveal_ok(&mut c, id);
        assert_eq!(bal(&c, accounts(5)), 1_000); // refund only
        assert_eq!(bal(&c, accounts(2)), 990); // total 1000, fee 10, all to the winner
        assert_eq!(bal(&c, accounts(0)), 10);
    }

    #[test]
    fn reveal_stores_the_authors() {
        let mut c = setup();
        let id = open_round(&mut c);
        guess(&mut c, accounts(2), id, 1, T0 + 1);
        reveal_ok(&mut c, id);
        assert_eq!(c.get_round(id).unwrap().authors, authors_liar());
    }

    fn sponsor_acct() -> AccountId {
        "sponsor.testnet".parse().unwrap()
    }

    fn sponsor(c: &mut Arena, id: u64, amount: u128, now: u64) {
        ctx(accounts(4), now);
        let _ = c.ft_on_transfer(sponsor_acct(), U128(amount), format!("S:{}", id));
    }

    #[test]
    fn sponsor_prize_goes_to_correct_guessers() {
        let mut c = setup();
        let id = open_round(&mut c);
        sponsor(&mut c, id, 501, T0 + 1);
        guess(&mut c, accounts(2), id, 1, T0 + 2); // right
        guess(&mut c, accounts(3), id, 1, T0 + 3); // right
        reveal_ok(&mut c, id);
        // pot 2000, fee 20, all net 1980 to winners = 990 each, plus 250 each from the prize
        assert_eq!(bal(&c, accounts(2)), 990 + 250);
        assert_eq!(bal(&c, accounts(3)), 990 + 250);
        assert_eq!(bal(&c, sponsor_acct()), 1); // rounding dust back to the sponsor
    }

    #[test]
    fn sponsor_prize_returns_when_nobody_is_right() {
        let mut c = setup();
        let id = open_round(&mut c);
        sponsor(&mut c, id, 500, T0 + 1);
        guess(&mut c, accounts(2), id, 0, T0 + 2);
        reveal_ok(&mut c, id);
        assert_eq!(bal(&c, sponsor_acct()), 500);
    }

    #[test]
    fn sponsor_prize_is_refunded_when_round_is_voided() {
        let mut c = setup();
        let id = open_round(&mut c);
        sponsor(&mut c, id, 500, T0 + 1);
        ctx(accounts(3), CLOSE + 3_600_001);
        c.void_round(id);
        assert_eq!(bal(&c, sponsor_acct()), 500);
    }

    #[test]
    #[should_panic(expected = "already sponsored")]
    fn only_one_sponsor_per_round() {
        let mut c = setup();
        let id = open_round(&mut c);
        sponsor(&mut c, id, 500, T0 + 1);
        sponsor(&mut c, id, 500, T0 + 2);
    }

    #[test]
    #[should_panic(expected = "commit mismatch")]
    fn wrong_commit_is_rejected() {
        let mut c = setup();
        let id = open_round(&mut c);
        ctx(accounts(1), CLOSE);
        c.reveal(id, 0, "salt".to_string(), authors_liar(), evidence(true, "provider_tee"));
    }

    #[test]
    fn unaccepted_evidence_voids_and_refunds() {
        let mut c = setup();
        let id = open_round(&mut c);
        guess(&mut c, accounts(2), id, 1, T0 + 1);
        guess(&mut c, accounts(3), id, 2, T0 + 2);
        ctx(accounts(1), CLOSE);
        c.reveal(id, 1, "salt".to_string(), authors_liar(), evidence(true, "gateway"));
        assert_eq!(c.get_round(id).unwrap().status, RoundStatus::Voided);
        assert_eq!(bal(&c, accounts(2)), 1_000);
        assert_eq!(bal(&c, accounts(3)), 1_000);
    }

    #[test]
    #[should_panic(expected = "dealer cannot play")]
    fn dealer_cannot_guess() {
        let mut c = setup();
        let id = open_round(&mut c);
        guess(&mut c, accounts(1), id, 0, T0 + 1);
    }

    #[test]
    #[should_panic(expected = "already guessed")]
    fn double_guess_is_rejected() {
        let mut c = setup();
        let id = open_round(&mut c);
        guess(&mut c, accounts(2), id, 0, T0 + 1);
        guess(&mut c, accounts(2), id, 1, T0 + 2);
    }

    #[test]
    #[should_panic(expected = "guessing closed")]
    fn late_guess_is_rejected() {
        let mut c = setup();
        let id = open_round(&mut c);
        guess(&mut c, accounts(2), id, 0, CLOSE + 1);
    }

    #[test]
    #[should_panic(expected = "guessing still open")]
    fn early_reveal_is_rejected() {
        let mut c = setup();
        let id = open_round(&mut c);
        ctx(accounts(1), T0 + 5);
        c.reveal(id, 1, "salt".to_string(), authors_liar(), evidence(true, "provider_tee"));
    }

    #[test]
    #[should_panic(expected = "only dealer")]
    fn only_dealer_can_reveal() {
        let mut c = setup();
        let id = open_round(&mut c);
        ctx(accounts(2), CLOSE);
        c.reveal(id, 1, "salt".to_string(), authors_liar(), evidence(true, "provider_tee"));
    }

    #[test]
    fn stuck_round_can_be_voided_after_grace() {
        let mut c = setup();
        let id = open_round(&mut c);
        guess(&mut c, accounts(2), id, 1, T0 + 1);
        ctx(accounts(3), CLOSE + 3_600_001);
        c.void_round(id);
        assert_eq!(bal(&c, accounts(2)), 1_000);
        assert_eq!(c.get_round(id).unwrap().status, RoundStatus::Voided);
    }
}
