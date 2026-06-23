export interface DailyCategory {
  tr: string;
  en: string;
}

const DAILY_CATEGORIES: DailyCategory[] = [
  { tr: "Pizza malzemeleri", en: "Pizza Toppings" },
  { tr: "Okul çantasında bulunacak şeyler", en: "Things in a School Bag" },
  { tr: "Müzik enstrümanları", en: "Musical Instruments" },
  { tr: "Spor markaları", en: "Sports Brands" },
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
