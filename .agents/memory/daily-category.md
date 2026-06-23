---
name: Daily Category feature
description: How the daily challenge rotation, scoring, and leaderboard work end-to-end.
---

## Category rotation
- Start date: 2026-06-23 UTC = day 0
- Categories cycle: Pizza malzemeleri → Okul çantasında bulunacak şeyler → Müzik enstrümanları → Spor markaları (then repeats)
- Logic in `artifacts/api-server/src/lib/daily.ts` — uses UTC date string, computes index from diff with START_MS

## DB
- Table: `daily_scores` (id, userId, date[YYYY-MM-DD], score, attemptNumber, createdAt)
- Schema: `lib/db/src/schema/daily_scores.ts`, exported in `lib/db/src/schema/index.ts`

## API routes (`artifacts/api-server/src/routes/daily.ts`)
- GET /api/daily/status → { date, dayIndex, category_tr, category_en, nextResetAt }
- GET /api/daily/leaderboard → top-10 best score per user for today
- GET /api/daily/my-status → { attemptsUsed, attemptsLeft, bestScore } (auth required)
- POST /api/daily/submit → { score } → { saved, attemptsLeft, bestScore, rank } (auth required, max 3 attempts)

## Frontend
- `DailyCategory.tsx` — fetches all 3 endpoints, countdown from `nextResetAt - Date.now()`, play button, leaderboard
- Home.tsx: Daily Category button added at top of action list
- App.tsx: `/daily` route added
- GameContext: `isDailyMode` boolean flag added
- GameScreen.tsx: skips soloToken fetch when `isDailyMode=true`
- Result.tsx: if isDailyMode, posts to /api/daily/submit instead of elo; exit goes back to /daily

**Why:** daily mode must not award Elo (it's a daily challenge, separate from Elo ladder). `customSubcategory: true` on the room prevents WS Elo, and `isDailyMode` flag prevents the REST solo Elo token fetch/submit.
