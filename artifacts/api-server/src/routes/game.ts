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
      ? `Sen bir kelime oyunu asistanısın. Verilen kategoriye uygun, GENIŞ ve eğlenceli bir alt kategori üret.

KURALLAR:
- Alt kategori kısa (2-4 kelime) ve basit olmalı
- Herkesin kolayca 5-10 örnek sayabileceği kadar geniş olmalı
- Çok özgün veya spesifik OLMA
- Sadece alt kategoriyi yaz, başka hiçbir şey yazma

İYİ ÖRNEKLER:
"Yiyecek & İçecek" → "Fast Food Zincirleri"
"Yiyecek & İçecek" → "Dondurma Markaları"  
"Yiyecek & İçecek" → "Gazlı İçecekler"
"Spor" → "Olimpik Sporlar"
"Spor" → "Futbol Dünya Kupası Ülkeleri"
"Müzik" → "90'lar Pop Sanatçıları"
"Müzik" → "İngiliz Rock Grupları"
"Film & Dizi" → "Marvel Filmleri"
"Film & Dizi" → "Disney Animasyon Filmleri"
"Hayvanlar" → "Safari Hayvanları"
"Hayvanlar" → "Popüler Köpek Irkları"
"Coğrafya" → "Avrupa Başkentleri"
"Tarih" → "Ünlü Savaşlar"

KÖTÜ ÖRNEKLER (çok spesifik):
"2010'ların Ödüllü Bağımsız Avrupa Filmleri" ❌
"1800'lerden Masa Oyunları" ❌`
      : `You are a word game assistant. Generate a BROAD, fun sub-category for the given category.

RULES:
- Keep it short (2-4 words) and simple
- Must be broad enough that players can easily name 5-10 examples
- Do NOT be overly specific or creative — keep it well-known
- Output only the sub-category name, nothing else

GOOD EXAMPLES:
"Food & Drink" → "Fast Food Chains"
"Food & Drink" → "Ice Cream Brands"
"Food & Drink" → "Popular Snack Brands"
"Sports" → "Olympic Sports"
"Sports" → "Soccer World Cup Countries"
"Music" → "90s Pop Artists"
"Music" → "Rock Bands from the UK"
"Film & TV" → "Marvel Superhero Movies"
"Film & TV" → "Disney Animated Films"
"Animals" → "African Safari Animals"
"Animals" → "Popular Dog Breeds"
"Geography" → "European Capital Cities"
"History" → "Famous Wars"
"Science" → "Planets in the Solar System"

BAD EXAMPLES (too specific):
"Award-Winning Independent European Films from the 2010s" ❌
"Board Games from the 1800s" ❌`;

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

YAZIM HATASI KURALI: Küçük yazım hataları veya imla yanlışları olsa bile, kastedilenin ne olduğu açıkça anlaşılıyorsa cevabı GEÇERLİ say. Örnek: "Macdonalds" → McDonald's GEÇERLİ.

TEKRAR KURALI (ÖNEMLİ): Eğer cevap, daha önce kabul edilmiş bir cevapla aynı şeyi ifade ediyorsa (yazım farkı olsa bile) GEÇERSIZ say. Örnek: önceki cevap "Paris" ise "Pars" veya "paris" da GEÇERSIZ.

Yanıtını SADECE şu JSON formatında ver: {"valid": true/false, "reason": "tek cümle açıklama"}
Başka hiçbir şey yazma.`
      : `You are a word game judge. Evaluate two things:
1. Does the player's answer fit this sub-category?
2. Has this answer (or a very similar version) already been used?

TYPO RULE: Accept answers with minor spelling mistakes or typos if the intended word is clearly understood. Example: "Macdonalds" → McDonald's is VALID.

DUPLICATE RULE (IMPORTANT): If the answer refers to the same thing as a previously accepted answer — even with different spelling — mark it INVALID. Example: if "Paris" was already accepted, then "Parris" or "paris" is also INVALID. Compare meaning, not just exact spelling.

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
