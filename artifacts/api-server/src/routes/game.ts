import { Router, type IRouter } from "express";
import { openai } from "../lib/openai";
import { verifyAnswer } from "../lib/verifyAnswer";
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

  const key = CATEGORY_TO_KEY[category];
  const poolOptions: string[] = key
    ? (() => {
        const pool = SUBCATEGORY_POOLS[key];
        return language === "tr" ? pool.tr : pool.en;
      })()
    : [];

  // 50% chance: return a direct random pick from the pool instantly (no AI latency)
  // 50% chance: ask AI to invent something fresh, using the pool as "inspiration, not repetition"
  if (poolOptions.length > 0 && Math.random() < 0.5) {
    const subcategory = poolOptions[Math.floor(Math.random() * poolOptions.length)];
    res.json({ subcategory });
    return;
  }

  // Show the full pool to AI so it knows what's been "done" and can branch out
  const poolList = poolOptions.length > 0
    ? poolOptions.join(", ")
    : "(no predefined examples)";

  const systemPrompt =
    language === "tr"
      ? `Sen bir kelime oyunu asistanısın. "${category}" kategorisi için GENİŞ, BASİT ve OYNANABILIR bir alt kategori üret.

KURALLAR:
- Kısa (2-4 kelime) olmalı.
- Oyuncuların kolayca 5-10 örnek yazabileceği kadar geniş olmalı.
- Aşağıdaki mevcut listede OLMAYAN, ancak benzer tarzda yeni bir alt kategori üret.
- Sadece alt kategoriyi yaz, başka hiçbir şey yazma.

Mevcut liste (tekrar ETME, ilham al):
${poolList}`
      : `You are a word game assistant. Generate a BROAD, SIMPLE, and PLAYABLE sub-category for the "${category}" category.

RULES:
- Keep it short (2-4 words).
- Players must be able to easily name 5-10 things in it.
- Invent something NOT already in the list below, but in the same style.
- Output ONLY the sub-category name, nothing else.

Existing list (do NOT repeat, use for inspiration):
${poolList}`;

  const userPrompt =
    language === "tr"
      ? `"${category}" için listede olmayan, basit ve oynanabilir yeni bir alt kategori üret.`
      : `Generate a fresh sub-category for "${category}" that is NOT in the existing list.`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 30,
      temperature: 1.3,
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
    // Fallback to a random pool pick if AI fails
    if (poolOptions.length > 0) {
      res.json({ subcategory: poolOptions[Math.floor(Math.random() * poolOptions.length)] });
    } else {
      res.status(500).json({ error: "Failed to generate sub-category" });
    }
  }
});

router.post("/game/verify-answer", async (req, res): Promise<void> => {
  const parsed = VerifyAnswerBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { answer, subcategory, previousAnswers, language } = parsed.data;

  try {
    const result = await verifyAnswer(answer, subcategory, previousAnswers, language);
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Failed to verify answer");
    res.status(500).json({ error: "Failed to verify answer" });
  }
});

export default router;
