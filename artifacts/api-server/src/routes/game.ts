import { Router, type IRouter } from "express";
import { openai } from "../lib/openai";
import { GenerateSubcategoryBody, VerifyAnswerBody } from "@workspace/api-zod";
import { logger } from "../lib/logger";
import { SUBCATEGORY_POOLS, CATEGORY_TO_KEY } from "../lib/subcategoryPools";

const router: IRouter = Router();

router.post("/game/generate-subcategory", async (req, res): Promise<void> => {
  const parsed = GenerateSubcategoryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { category, language } = parsed.data;

  // If it's a predefined category, pick randomly from the large pool — no AI needed
  const key = CATEGORY_TO_KEY[category];
  if (key) {
    const pool = SUBCATEGORY_POOLS[key];
    const options = language === "tr" ? pool.tr : pool.en;
    const subcategory = options[Math.floor(Math.random() * options.length)];
    res.json({ subcategory });
    return;
  }

  // Custom category: ask AI to generate a fitting sub-category
  const systemPrompt =
    language === "tr"
      ? `Sen bir kelime oyunu asistanısın. Verilen kategoriye uygun, GENIŞ ve eğlenceli bir alt kategori üret.
KURALLAR: Alt kategori kısa (2-4 kelime) ve basit olmalı. Herkesin kolayca 5-10 örnek sayabileceği kadar geniş olmalı. Sadece alt kategoriyi yaz, başka hiçbir şey yazma.`
      : `You are a word game assistant. Generate a BROAD, fun sub-category for the given category.
RULES: Keep it short (2-4 words) and simple. Must be broad enough that players can easily name 5-10 examples. Output only the sub-category name, nothing else.`;

  const userPrompt =
    language === "tr"
      ? `Kategori: "${category}". Geniş ve basit bir alt kategori üret.`
      : `Category: "${category}". Generate a broad, simple sub-category.`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 30,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });

    const subcategory =
      completion.choices[0]?.message?.content?.trim() ?? category;
    res.json({ subcategory });
  } catch (err) {
    req.log.error({ err }, "Failed to generate sub-category");
    res.status(500).json({ error: "Failed to generate sub-category" });
  }
});

router.post("/game/verify-answer", async (req, res): Promise<void> => {
  const parsed = VerifyAnswerBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { answer, subcategory, previousAnswers, language } = parsed.data;

  const systemPrompt =
    language === "tr"
      ? `Sen bir kelime oyunu hakemisin. İki şeyi değerlendir:
1. Oyuncunun cevabı bu alt kategoriye uygun mu?
2. Bu cevap (veya çok benzer bir versiyonu) daha önce kullanılmış mı?

YAZIM HATASI KURALI: Küçük yazım hataları olsa bile, kastedilenin ne olduğu açıkça anlaşılıyorsa cevabı GEÇERLİ say.
TEKRAR KURALI: Eğer cevap, daha önce kabul edilmiş bir cevapla aynı şeyi ifade ediyorsa GEÇERSIZ say.

Yanıtını SADECE şu JSON formatında ver: {"valid": true/false, "reason": "tek cümle açıklama"}
Başka hiçbir şey yazma.`
      : `You are a word game judge. Evaluate two things:
1. Does the player's answer fit this sub-category?
2. Has this answer (or a very similar version) already been used?

TYPO RULE: Accept answers with minor spelling mistakes if the intended word is clearly understood.
DUPLICATE RULE: If the answer refers to the same thing as a previously accepted answer — even with different spelling — mark it INVALID.

Respond ONLY in this JSON format: {"valid": true/false, "reason": "one sentence explanation"}
Write nothing else.`;

  const userPrompt =
    language === "tr"
      ? `Alt kategori: "${subcategory}"
Daha önce kabul edilen cevaplar: ${previousAnswers.length ? previousAnswers.join(", ") : "yok"}
Oyuncunun cevabı: "${answer}"`
      : `Sub-category: "${subcategory}"
Previously accepted answers: ${previousAnswers.length ? previousAnswers.join(", ") : "none"}
Player's answer: "${answer}"`;

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
    let parsed_result: { valid?: boolean; reason?: string };
    try {
      parsed_result = JSON.parse(raw);
    } catch {
      parsed_result = { valid: false, reason: "Could not parse response" };
    }

    res.json({
      valid: parsed_result.valid === true,
      reason: parsed_result.reason ?? "",
    });
  } catch (err) {
    req.log.error({ err }, "Failed to verify answer");
    res.status(500).json({ error: "Failed to verify answer" });
  }
});

export default router;
