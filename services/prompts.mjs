// Fresh, open-ended prompts. The answer does not exist anywhere until the model writes it,
// so there is nothing to look up. Templates and slots combine into thousands of different rounds.
import { randomInt } from "node:crypto";
const pick = (a) => a[randomInt(a.length)];
const who = ["a bank", "a lighthouse keeper", "a tired barista", "a goat farmer", "an airline", "a retired wizard", "a startup founder", "a ferry captain", "a pigeon", "a museum guard", "a landlord", "a weather forecaster"];
const to = ["a customer", "the neighbours", "a customs officer", "a first date", "a rival", "the moon", "a stranger on a train", "an old friend", "the city council"];
const mishap = ["losing a parcel", "burning the soup", "missing a deadline", "mixing up two names", "locking everyone out", "forgetting a birthday", "double-booking the hall"];
const thing = ["a spoon", "a traffic light", "a thunderstorm", "a Monday", "a password", "a mango", "an umbrella", "a lift", "a compass", "a receipt"];
const place = ["Lagos", "Nairobi", "a night market", "a train station at 5am", "a library after closing", "a rooftop", "a desert road"];
// Lanes change the setting of the prompt, never the skill. The question is always the same:
// which of these did the machine write? Prompts ask for voice and writing, never for facts to look up,
// and the health and law lanes are about tone, not advice.
const org = ["a clinic", "a law firm", "a bank", "a school", "a landlord", "an airline", "a delivery company", "a city council"];
const person = ["a worried parent", "a first-year student", "a small-shop owner", "a night-shift nurse", "a junior lawyer", "a retired teacher"];
const crypto = ["a wallet", "a validator", "a gas fee", "a seed phrase", "an airdrop", "a smart contract", "a bridge"];
const LANES = {
  everyday: [
    () => `Write a one-sentence apology from ${pick(who)} to ${pick(to)} for ${pick(mishap)}.`,
    () => `Describe ${pick(thing)} to someone who has never seen one, in two sentences, without using the word "the".`,
    () => `Give a two-sentence weather report for ${pick(place)} as ${pick(who)} would write it.`,
    () => `Write the opening line of a story set in ${pick(place)} that mentions ${pick(thing)}.`,
  ],
  work: [
    () => `Write a polite two-sentence refusal from ${pick(org)} to ${pick(to)}.`,
    () => `Write a one-sentence out-of-office reply from ${pick(person)} that is honest about being overwhelmed.`,
    () => `Write a short thank-you note from ${pick(org)} to ${pick(person)}, in two sentences.`,
    () => `Write a two-sentence notice from ${pick(org)} about ${pick(mishap)}, in a calm professional tone.`,
  ],
  care: [
    () => `Write two warm sentences ${pick(person)} could say to a friend who is nervous about ${pick(["a hospital visit", "an exam", "a court date", "a job interview"])}. No advice, just kindness.`,
    () => `Explain to a child, in two sentences, why ${pick(["sleep", "washing hands", "drinking water", "listening"])} matters.`,
    () => `Write a gentle one-sentence reminder from ${pick(org)} about ${pick(["an appointment", "a deadline", "a signature"])}.`,
  ],
  crypto: [
    () => `Explain ${pick(crypto)} to ${pick(person)} in two plain sentences, without jargon.`,
    () => `Write a one-sentence warning about ${pick(["scam links", "fake support accounts", "sharing a seed phrase"])} that a friendly community moderator would post.`,
    () => `Write a two-sentence announcement from ${pick(who)} about a ${pick(crypto)} that sounds excited but honest.`,
  ],
  creative: [
    () => `Write a short product slogan for ${pick(thing)} that is honest about its flaws.`,
    () => `Invent a proverb about ${pick(thing)} and explain it in one sentence.`,
    () => `In two sentences, explain to a child why ${pick(thing)} matters, using ${pick(place)} as the example.`,
  ],
};
export const LANE_NAMES = Object.keys(LANES);
export const freshPrompt = (lane = "mix") => {
  const l = lane === "mix" || !LANES[lane] ? pick(LANE_NAMES) : lane;
  return `${pick(LANES[l])()} Reply with only the text, at most two sentences.`;
};

// Harder tiers get decoys that try harder to imitate the real model.
export const TIERS = {
  1: { answers: 2, name: "Easy", system: "Write the reply the way a hurried person typing on a phone would. Plain, slightly clumsy, no polish. At most two sentences. Output only the reply." },
  2: { answers: 3, name: "Medium", system: "Write the reply as a skilled human copywriter with a distinct, slightly quirky voice. At most two sentences. Output only the reply." },
  3: { answers: 4, name: "Hard", system: "Write the reply so it is indistinguishable from what a polished AI assistant would write: same tone, same rhythm, same level of polish. At most two sentences. Output only the reply." },
  4: { answers: 5, name: "Daily Boss", system: "You are the Boss, a deceptive agent. Write the reply so it is indistinguishable from a polished AI assistant's answer, including its rhythm, hedging and word choice. Never sound like a person. At most two sentences. Output only the reply." },
};
