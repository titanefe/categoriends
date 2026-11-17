export interface DailyCategory {
  tr: string;
  en: string;
}

const DAILY_CATEGORIES: DailyCategory[] = [
  { tr: "Pizza malzemeleri", en: "Pizza Toppings" },
  { tr: "Okul çantasında bulunacak şeyler", en: "Things in a School Bag" },
  { tr: "Müzik enstrümanları", en: "Musical Instruments" },
  { tr: "Spor markaları", en: "Sports Brands" },
  { tr: "Çiçek türleri", en: "Types of Flowers" },
  { tr: "Olimpiyatlarda olan sporlar", en: "Olympic Sports" },
  { tr: "Kahvaltı yiyecekleri", en: "Breakfast Foods" },
  { tr: "Bir kadına alınabilecek hediyeler", en: "Gifts for Women" },
  { tr: "Kötü kokan şeyler", en: "Things That Smell Bad" },
  { tr: "Giyim markaları", en: "Clothing Brands" },
];

/**
 * Upcoming daily categories, one per day starting at QUEUE_START (UTC).
 * To schedule more days, append to the end of this list — order = day order.
 * When the queue runs out, the game falls back to rotating through every
 * category (DAILY_CATEGORIES + DAILY_QUEUE), so a day is never empty.
 */
const QUEUE_START = "2026-11-18";

const DAILY_QUEUE: DailyCategory[] = [
  { tr: "Meyveler", en: "Fruits" },                                   // 18 Kas
  { tr: "Sebzeler", en: "Vegetables" },                               // 19 Kas
  { tr: "Meslekler", en: "Jobs" },                                    // 20 Kas
  { tr: "Ülkeler", en: "Countries" },                                 // 21 Kas
  { tr: "Mutfakta bulunan eşyalar", en: "Things in a Kitchen" },      // 22 Kas
  { tr: "Hayvanat bahçesindeki hayvanlar", en: "Zoo Animals" },       // 23 Kas
  { tr: "Tatlılar", en: "Desserts" },                                 // 24 Kas
  { tr: "Araba markaları", en: "Car Brands" },                        // 25 Kas
  { tr: "Vücudun bölümleri", en: "Body Parts" },                      // 26 Kas
  { tr: "Kışın giyilen şeyler", en: "Winter Clothes" },               // 27 Kas
  { tr: "İçecekler", en: "Drinks" },                                  // 28 Kas
  { tr: "Ulaşım araçları", en: "Means of Transport" },                // 29 Kas
  { tr: "Denizde yaşayan hayvanlar", en: "Sea Animals" },             // 30 Kas
  { tr: "Başkentler", en: "Capital Cities" },                         // 1 Ara
  { tr: "Banyoda bulunan şeyler", en: "Things in a Bathroom" },       // 2 Ara
  { tr: "Oyuncaklar", en: "Toys" },                                   // 3 Ara
  { tr: "Renkler", en: "Colors" },                                    // 4 Ara
  { tr: "Kuş türleri", en: "Types of Birds" },                        // 5 Ara
  { tr: "Futbol takımları", en: "Football Clubs" },                   // 6 Ara
  { tr: "Evdeki mobilyalar", en: "Furniture" },                       // 7 Ara
  { tr: "Böcekler", en: "Insects" },                                  // 8 Ara
  { tr: "Tatil bavuluna konan şeyler", en: "Things You Pack for a Holiday" }, // 9 Ara
  { tr: "Kırtasiye malzemeleri", en: "Stationery" },                  // 10 Ara
  { tr: "Elektronik cihazlar", en: "Electronic Devices" },            // 11 Ara
  { tr: "Fast food yiyecekleri", en: "Fast Food" },                   // 12 Ara
  { tr: "Takım sporları", en: "Team Sports" },                        // 13 Ara
  { tr: "Baharatlar", en: "Spices" },                                 // 14 Ara
  { tr: "Dünya şehirleri", en: "Cities of the World" },               // 15 Ara
  { tr: "Doğum günü partisinde olan şeyler", en: "Things at a Birthday Party" }, // 16 Ara
  { tr: "Yılbaşı ile ilgili şeyler", en: "Things Related to New Year" }, // 17 Ara
];

const ALL_CATEGORIES: DailyCategory[] = [...DAILY_CATEGORIES, ...DAILY_QUEUE];

const START_MS = Date.UTC(2026, 5, 23); // 2026-06-23 UTC (month is 0-indexed)
const QUEUE_START_MS = Date.parse(QUEUE_START + "T00:00:00Z");

export function getTodayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysSince(startMs: number, dateStr: string): number {
  return Math.floor((Date.parse(dateStr + "T00:00:00Z") - startMs) / 86_400_000);
}

function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

/** Index into ALL_CATEGORIES for the given UTC date. */
function getDayIndex(dateStr: string): number {
  const q = daysSince(QUEUE_START_MS, dateStr);
  if (q < 0) {
    // Before the queue started: original 10-category rotation.
    return mod(daysSince(START_MS, dateStr), DAILY_CATEGORIES.length);
  }
  if (q < DAILY_QUEUE.length) {
    return DAILY_CATEGORIES.length + q;
  }
  // Queue exhausted: rotate through every category.
  return mod(q - DAILY_QUEUE.length, ALL_CATEGORIES.length);
}

export function getCategoryForDate(dateStr: string): DailyCategory {
  return ALL_CATEGORIES[getDayIndex(dateStr)];
}

export function getCurrentDailyStatus() {
  const today = getTodayUtc();
  const dayIndex = getDayIndex(today);
  const category = ALL_CATEGORIES[dayIndex];

  // nextResetAt = midnight UTC at the start of tomorrow
  const tomorrowDate = new Date(today + "T00:00:00Z");
  tomorrowDate.setUTCDate(tomorrowDate.getUTCDate() + 1);
  const nextResetAt = tomorrowDate.getTime();

  return { today, dayIndex, category, nextResetAt };
}

export const MAX_DAILY_ATTEMPTS = 3;
