import { openai } from "./openai";
import { logger } from "./logger";

export async function verifyAnswer(
  answer: string,
  subcategory: string,
  previousAnswers: string[],
  language: string,
): Promise<{ valid: boolean; reason: string }> {
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
    let parsed: { valid?: boolean; reason?: string };
    try {
      parsed = JSON.parse(raw) as { valid?: boolean; reason?: string };
    } catch {
      parsed = { valid: false, reason: "Could not parse response" };
    }

    return { valid: parsed.valid === true, reason: parsed.reason ?? "" };
  } catch (err) {
    logger.error({ err }, "Failed to verify answer");
    return { valid: false, reason: "Verification failed" };
  }
}
