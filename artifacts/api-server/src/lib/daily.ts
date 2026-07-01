export interface DailyCategory {
  tr: string;
  en: string;
}

const DAILY_CATEGORIES: DailyCategory[] = [
  { tr: "Pizza malzemeleri", en: "Pizza Toppings" },
  { tr: "Okul \u00e7antas\u0131nda bulunacak \u015feyler", en: "Things in a School Bag" },
  { tr: "M\u00fczik enstr\u00fcmanlar\u0131", en: "Musical Instruments" },
  { tr: "Spor markalar\u0131", en: "Sports Brands" },
  { tr: "Bir kad\u0131na al\u0131nabilecek hediyeler", en: "Gifts for Women" },
  { tr: "Kahvalt\u0131 yiyecekleri", en: "Breakfast Foods" },
  { tr: "Olimpiyatlarda olan sporlar", en: "Olympic Sports" },
  { tr: "K\u00f6t\u00fc kokan \u015feyler", en: "Things That Smell Bad" },
  { tr: "Giyim markalar\u0131", en: "Clothing Brands" },
  { tr: "\u00c7i\u00e7ek t\u00fcrleri", en: "Types of Flowers" },
];

const START_MS = Date.UTC(2026, 5, 23); // 2026-06-23 UTC (month is 0-indexed)

export function getTodayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function getDayIndex(dateStr: string): number {
  const dayMs = new Date(dateStr + "T00:00:00Z").getTime();
  const diff = Math.floor((dayMs - START_MS) / 86_400_000);
  return ((diff % DAILY_CATEGORIES.length) + DAILY_CATEGORIES.length) % DAILY_CATEGORIES.length;
}

export function getCurrentDailyStatus() {
  const today = getTodayUtc();
  const dayIndex = getDayIndex(today);
  const category = DAILY_CATEGORIES[dayIndex];

  // nextResetAt = midnight UTC at the start of tomorrow
  const tomorrowDate = new Date(today + "T00:00:00Z");
  tomorrowDate.setUTCDate(tomorrowDate.getUTCDate() + 1);
  const nextResetAt = tomorrowDate.getTime();

  return { today, dayIndex, category, nextResetAt };
}

export const MAX_DAILY_ATTEMPTS = 3;
