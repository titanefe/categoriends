import { Router, type IRouter } from "express";
import { openai } from "../lib/openai";
import { GenerateSubcategoryBody, VerifyAnswerBody } from "@workspace/api-zod";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.post("/game/generate-subcategory", async (req, res): Promise<void> => {
  const parsed = GenerateSubcategoryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { category, language } = parsed.data;

  const systemPrompt =
    language === "tr"
      ? `Sen bir oyun asistanısın. Verilen ana kategoriye uygun, çok özgün ve spesifik bir alt kategori üret. 
         Alt kategori kısa (3-6 kelime) ve net olmalı. Sadece alt kategoriyi yaz, başka hiçbir şey yazma.
         Örnek: "Games" → "2010'ların Ödüllü Video Oyunları"`
      : `You are a game assistant. Generate a highly specific, creative sub-category for the given main category.
         The sub-category should be short (3-6 words) and precise. Output only the sub-category, nothing else.
         Example: "Games" → "Award-Winning Games from the 2010s"`;

  const userPrompt =
    language === "tr"
      ? `Ana kategori: "${category}". Spesifik bir alt kategori üret.`
      : `Main category: "${category}". Generate a specific sub-category.`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 60,
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
      ? `Sen bir oyun hakemisin. Oyuncunun cevabını değerlendir:
1. Cevap alt kategoriye uygun mu?
2. Daha önce kullanılmış mı?

Yanıtını MUTLAKA şu JSON formatında ver: {"valid": true/false, "reason": "kısa açıklama"}
Açıklama 1 cümle olmalı. Başka hiçbir şey yazma.`
      : `You are a game judge. Evaluate if the player's answer:
1. Fits the sub-category
2. Has NOT already been used

Respond ONLY in this JSON format: {"valid": true/false, "reason": "brief explanation"}
The reason should be 1 sentence. Write nothing else.`;

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
      max_tokens: 100,
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
