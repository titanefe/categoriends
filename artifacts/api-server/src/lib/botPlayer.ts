import { openai } from "./openai";
import { logger } from "./logger";

export interface BotState {
  botId: string;
  roomCode: string;
  maxAnswers: number;
  answersGiven: number;
  language: "en" | "tr";
  category: string;
  subcategory: string;
}

const botStates = new Map<string, BotState>();

const EN_NAMES = [
  "Alex", "Sam", "Jordan", "Riley", "Morgan", "Casey", "Taylor",
  "Jamie", "Quinn", "Blake", "Drew", "Avery", "Logan", "Rowan", "Finley",
];

const TR_NAMES = [
  "Burak", "Ceren", "Deniz", "Ece", "Emre", "Fatma", "Hasan", "İrem",
  "Kaan", "Leyla", "Mete", "Naz", "Ömer", "Selin", "Tuna", "Yağmur",
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
    botId,
    roomCode,
    maxAnswers: 4 + Math.floor(Math.random() * 4), // 4–7 correct answers
    answersGiven: 0,
    language: lang,
    category,
    subcategory,
  };
  botStates.set(botId, state);
  return state;
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

export function botHasAnswersLeft(botId: string): boolean {
  const s = botStates.get(botId);
  return !!s && s.answersGiven < s.maxAnswers;
}

export function incrementBotAnswers(botId: string): void {
  const s = botStates.get(botId);
  if (s) s.answersGiven++;
}

export async function generateBotAnswer(
  state: BotState,
  acceptedAnswers: string[],
): Promise<string | null> {
  try {
    const usedList = acceptedAnswers.length > 0 ? acceptedAnswers.join(", ") : "none";
    const system =
      state.language === "tr"
        ? `Sen bir kelime oyunu asistanısın. "${state.subcategory}" alt kategorisi için tek bir kısa ve geçerli cevap ver. Zaten kullanılan cevaplar: ${usedList}. Sadece cevabı yaz, başka hiçbir şey yazma.`
        : `You are a word game assistant. Give a single short valid answer for the sub-category "${state.subcategory}". Already used answers: ${usedList}. Output ONLY the answer, nothing else.`;
    const user =
      state.language === "tr"
        ? `"${state.subcategory}" için yeni bir cevap ver.`
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

    const raw = completion.choices[0]?.message?.content?.trim() ?? null;
    return raw;
  } catch (err) {
    logger.error({ err }, "Bot answer generation error");
    return null;
  }
}
