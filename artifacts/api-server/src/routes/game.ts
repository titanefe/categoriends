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

  // Build a pool of examples for the AI (predefined or custom)
  const key = CATEGORY_TO_KEY[category];
  let examples: string[] = [];
  if (key) {
    const pool = SUBCATEGORY_POOLS[key];
    const options = language === "tr" ? pool.tr : pool.en;
    // Shuffle and pick 5 random examples to show the AI
    const shuffled = [...options].sort(() => Math.random() - 0.5);
    examples = shuffled.slice(0, 5);
  }

  const systemPrompt =
    language === "tr"
      ? `Sen bir kelime oyunu asistanısın. Verilen kategoriye uygun, GENİŞ ve eğlenceli bir alt kategori üret.

KURALLAR:
- Alt kategori kısa (2-4 kelime) ve basit olmalı.
- Herkesin kolayca 5-10 örnek sayabileceği kadar geniş olmalı.
- OYNAKANABİLİR olmalı: oyuncuların alt kategoriyle ilgili şeyler DÜŞÜNÜP YAZABİLECEĞİ bir konu olmalı.
- Aşağıdaki örneklerden BİRİNİ de verebilir, veya bunlara benzeyen tamamen YENİ bir alt kategori üretebilirsin.
- Sadece alt kategoriyi yaz, başka hiçbir şey yazma.`
      : `You are a word game assistant. Generate a BROAD, fun sub-category for the given category.

RULES:
- Keep it short (2-4 words) and simple.
- Must be broad enough that players can easily name 5-10 examples.
- Must be PLAYABLE: players must be able to think of and write things related to this topic.
- You may return ONE of the examples below, or generate a completely NEW sub-category inspired by them.
- Output ONLY the sub-category name, nothing else.`;

  const userPrompt =
    language === "tr"
      ? `Kategori: "${category}"

Örnek alt kategoriler (bunlardan biri veya bunlara benzer yeni biri):
${examples.map((e, i) => `${i + 1}. ${e}`).join("\n")}

Yukarıdaki örneklerden biri veya bunlara benzeyen basit, geniş ve oynanabilir bir alt kategori üret.`
      : `Category: "${category}"

Example sub-categories (return one of these or a new one inspired by them):
${examples.map((e, i) => `${i + 1}. ${e}`).join("\n")}

Generate a broad, simple, and playable sub-category.`;

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
      ? `Sen bir kelime oyunu hakemisin. Bir cevabın GEÇERLİ mi GEÇERSIZ mi olduğuna karar ver.

ADIM 1 — KATEGORİ UYUMU: Cevap alt kategoriye uyuyor mu? Açıkça yanlışsa GEÇERSIZ.

ADIM 2 — TEKRAR KONTROLÜ: Daha önce kabul edilmiş cevaplarla karşılaştır. Daha önce kabul edilmiş herhangi bir cevap, bu cevapla aynı gerçek dünya nesnesini/kavramını ifade ediyorsa — yazım, dil veya büyük/küçük harf farkı ne olursa olsun — GEÇERSIZ say.

TEMEL KURALLAR:
- Yazım hatası olan cevaplar kabul edilebilir: "Spiderman" → daha önce kabul edilmediyse GEÇERLİ.
- Farklı dillerdeki karşılıklar aynı cevaptır: "kedi" ve "cat" tekrardır.
- Yanlış yazılmış bir versiyon kabul edildiyse, doğru yazılmış versiyonu da REDDET.
- Doğru yazılmış versiyon kabul edildiyse, yanlış yazılmış versiyonu da REDDET.
- Bir gerçek dünya nesnesinin yalnızca ilk gönderilen versiyonu sayılır.
- ÖNEMLİ: Sadece benzer görünen veya ses çıkaran isimler, farklı gerçek dünya nesneleriyse ASLA tekrar sayılmaz. "Afganistan" ve "Kazakistan" tamamen farklı ülkelerdir — asla tekrar sayılamaz. Bu kuralı tüm özel isimlere uygula.

Yanıtını SADECE şu JSON formatında ver: {"valid": true/false, "reason": "tek cümle açıklama"}
Başka hiçbir şey yazma.`
      : `You are a word game judge. Decide if a player's answer is VALID or INVALID.

STEP 1 — CATEGORY FIT: Does the answer fit the sub-category? If clearly wrong, mark INVALID.

STEP 2 — DUPLICATE CHECK: Compare against all previously accepted answers. If ANY previously accepted answer refers to the same real-world thing — regardless of spelling, language, or casing — mark INVALID.

KEY RULES:
- Misspelled answers are fine: "Spiderman" → VALID if no equivalent has been accepted yet.
- Cross-language equivalents are the same answer: "cat" and "kedi" are duplicates of each other.
- If a misspelled version was already accepted, reject the correctly spelled version too.
- If the correct version was already accepted, reject any misspelled version too.
- Only the FIRST submitted variant of any real-world thing counts.
- CRITICAL: Names that merely look or sound similar are NOT duplicates if they are different real-world things. "Afghanistan" and "Kazakhstan" are completely different countries — never mark them as duplicates. Apply this rule to all proper nouns.

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
