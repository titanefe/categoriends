import { openai } from "./openai";
import { logger } from "./logger";

export interface BotState {
  botId: string;
  roomCode: string;
  language: "en" | "tr";
  category: string;
  subcategory: string;
  maxAnswers: number;
  answersGiven: number;
}

const botStates = new Map<string, BotState>();

const EN_NAMES = [
  "Alex", "Sam", "Jordan", "Riley", "Morgan", "Casey", "Taylor",
  "Jamie", "Quinn", "Blake", "Drew", "Avery", "Logan", "Rowan", "Finley",
];

const TR_NAMES = [
  "Burak", "Ceren", "Deniz", "Ece", "Emre", "Fatma", "Hasan", "\u0130rem",
  "Kaan", "Leyla", "Mete", "Naz", "\u00d6mer", "Selin", "Tuna", "Ya\u011fmur",
];

export function randomBotName(lang: "en" | "tr"): string {
  const pool = lang === "tr" ? TR_NAMES : EN_NAMES;
  return pool[Math.floor(Math.random() * pool.length)];
}

export function createBotState(
  botId: string,
  roomCode: string,
  lang: "en" | "tr",
  category: string,
  subcategory: string,
): BotState {
  const state: BotState = {
    botId, roomCode, language: lang, category, subcategory,
    maxAnswers: 8 + Math.floor(Math.random() * 3), // 8–10 correct answers
    answersGiven: 0,
  };
  botStates.set(botId, state);
  return state;
}

export function botHasAnswersLeft(botId: string): boolean {
  const s = botStates.get(botId);
  return !!s && s.answersGiven < s.maxAnswers;
}

export function incrementBotAnswers(botId: string): void {
  const s = botStates.get(botId);
  if (s) s.answersGiven++;
}

export function getBotState(botId: string): BotState | undefined {
  return botStates.get(botId);
}

export function removeBotState(botId: string): void {
  botStates.delete(botId);
}

export function isBotId(id: string): boolean {
  return id.startsWith("bot_");
}

/**
 * Generate a candidate answer for the bot, avoiding already-accepted answers.
 */
export async function generateBotAnswer(
  state: BotState,
  acceptedAnswers: string[],
): Promise<string | null> {
  try {
    const usedList = acceptedAnswers.length > 0 ? acceptedAnswers.join(", ") : "none";
    const system =
      state.language === "tr"
        ? `Sen bir kelime oyunu oyuncususun. "${state.subcategory}" alt kategorisi i\u00e7in tek bir k\u0131sa ve ge\u00e7erli cevap ver. Zaten kullan\u0131lan cevaplar: ${usedList}. Sadece cevab\u0131 yaz, ba\u015fka hi\u00e7bir \u015fey yazma.`
        : `You are a word game player. Give a single short valid answer for the sub-category "${state.subcategory}". Already used answers: ${usedList}. Output ONLY the answer, nothing else.`;
    const user =
      state.language === "tr"
        ? `"${state.subcategory}" i\u00e7in yeni bir cevap ver.`
        : `Give a fresh answer for "${state.subcategory}".`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 20,
      temperature: 0.9,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });

    return completion.choices[0]?.message?.content?.trim() ?? null;
  } catch (err) {
    logger.error({ err }, "Bot answer generation error");
    return null;
  }
}

/**
 * Verify a bot answer using the same judge prompt as real players.
 * Returns { valid, reason }.
 */
export async function verifyBotAnswer(
  answer: string,
  subcategory: string,
  acceptedAnswers: string[],
  language: "en" | "tr",
): Promise<{ valid: boolean; reason: string }> {
  const systemPrompt =
    language === "tr"
      ? `Sen bir kelime oyunu hakemisin. Bir cevab\u0131n GE\u00c7ERL\u0130 mi GE\u00c7ERS\u0130Z mi oldu\u011funa karar ver.

ADIM 1 \u2014 KATETOR\u0130 UYUMU: Cevap alt kategoriye uyuyor mu? A\u00e7\u0131k\u00e7a yanl\u0131\u015fsa GE\u00c7ERS\u0130Z.

ADIM 2 \u2014 TEKRAR KONTROL\u00dc: Daha \u00f6nce kabul edilmi\u015f cevaplarla kar\u015f\u0131la\u015ft\u0131r. Daha \u00f6nce kabul edilmi\u015f herhangi bir cevap, bu cevapla ayn\u0131 ger\u00e7ek d\u00fcnya nesnesini/kavram\u0131n\u0131 ifade ediyorsa \u2014 yaz\u0131m, dil veya b\u00fcy\u00fck/k\u00fc\u00e7\u00fck harf fark\u0131 ne olursa olsun \u2014 GE\u00c7ERS\u0130Z say.

Yan\u0131t\u0131n\u0131 SADECE \u015fu JSON format\u0131nda ver: {"valid": true/false, "reason": "tek c\u00fcmle a\u00e7\u0131klama"}
Ba\u015fka hi\u00e7bir \u015fey yazma.`
      : `You are a word game judge. Decide if a player's answer is VALID or INVALID.

STEP 1 \u2014 CATEGORY FIT: Does the answer fit the sub-category? If clearly wrong, mark INVALID.

STEP 2 \u2014 DUPLICATE CHECK: Compare against all previously accepted answers. If ANY previously accepted answer refers to the same real-world thing \u2014 regardless of spelling, language, or casing \u2014 mark INVALID.

Respond ONLY in this JSON format: {"valid": true/false, "reason": "one sentence explanation"}
Write nothing else.`;

  const userPrompt =
    language === "tr"
      ? `Alt kategori: "${subcategory}"\nDaha \u00f6nce kabul edilen cevaplar: ${acceptedAnswers.length ? acceptedAnswers.join(", ") : "yok"}\nOyuncunun cevab\u0131: "${answer}"`
      : `Sub-category: "${subcategory}"\nPreviously accepted answers: ${acceptedAnswers.length ? acceptedAnswers.join(", ") : "none"}\nPlayer's answer: "${answer}"`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 80,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
    });

    const raw = completion.choices[0]?.message?.content?.trim() ?? "{}";
    let parsed: { valid?: boolean; reason?: string };
    try {
      parsed = JSON.parse(raw) as { valid?: boolean; reason?: string };
    } catch {
      parsed = { valid: false, reason: "Parse error" };
    }
    return { valid: parsed.valid === true, reason: parsed.reason ?? "" };
  } catch (err) {
    logger.error({ err }, "Bot answer verification error");
    return { valid: false, reason: "Verification failed" };
  }
}
