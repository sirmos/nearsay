// Fresh, open-ended prompts. The answer does not exist anywhere until the model writes it,
// so there is nothing to look up. Templates and slots combine into thousands of different rounds.
import { randomInt } from "node:crypto";
const pick = (a) => a[randomInt(a.length)];
const who = ["a bank", "a lighthouse keeper", "a tired barista", "a goat farmer", "an airline", "a retired wizard", "a startup founder", "a ferry captain", "a pigeon", "a museum guard", "a landlord", "a weather forecaster"];
const to = ["a customer", "the neighbours", "a customs officer", "a first date", "a rival", "the moon", "a stranger on a train", "an old friend", "the city council"];
const mishap = ["losing a parcel", "burning the soup", "missing a deadline", "mixing up two names", "locking everyone out", "forgetting a birthday", "double-booking the hall"];
const thing = ["a spoon", "a traffic light", "a thunderstorm", "a Monday", "a password", "a mango", "an umbrella", "a lift", "a compass", "a receipt"];
const place = ["Lagos", "Nairobi", "a night market", "a train station at 5am", "a library after closing", "a rooftop", "a desert road"];
const T = [
  () => `Write a one-sentence apology from ${pick(who)} to ${pick(to)} for ${pick(mishap)}.`,
  () => `Describe ${pick(thing)} to someone who has never seen one, in two sentences, without using the word "the".`,
  () => `Give a two-sentence weather report for ${pick(place)} as ${pick(who)} would write it.`,
  () => `Write a short product slogan for ${pick(thing)} that is honest about its flaws.`,
  () => `Write the opening line of a story set in ${pick(place)} that mentions ${pick(thing)}.`,
  () => `In two sentences, explain to a child why ${pick(thing)} matters, using ${pick(place)} as the example.`,
  () => `Write a polite refusal from ${pick(who)} to ${pick(to)}, in at most two sentences.`,
  () => `Invent a proverb about ${pick(thing)} and explain it in one sentence.`,
];
export const freshPrompt = () => `${pick(T)()} Reply with only the text, at most two sentences.`;

// Harder tiers get decoys that try harder to imitate the real model.
export const TIERS = {
  1: { answers: 2, name: "Easy", system: "Write the reply the way a hurried person typing on a phone would. Plain, slightly clumsy, no polish. At most two sentences. Output only the reply." },
  2: { answers: 3, name: "Medium", system: "Write the reply as a skilled human copywriter with a distinct, slightly quirky voice. At most two sentences. Output only the reply." },
  3: { answers: 4, name: "Hard", system: "Write the reply so it is indistinguishable from what a polished AI assistant would write: same tone, same rhythm, same level of polish. At most two sentences. Output only the reply." },
  4: { answers: 5, name: "Daily Boss", system: "You are the Boss, a deceptive agent. Write the reply so it is indistinguishable from a polished AI assistant's answer, including its rhythm, hedging and word choice. Never sound like a person. At most two sentences. Output only the reply." },
};
