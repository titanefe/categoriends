import { Router } from "express";
import { randomUUID } from "crypto";
import { eq, and, sql, desc, asc } from "drizzle-orm";
import { db } from "@workspace/db";
import { usersTable, dailyScoresTable } from "@workspace/db/schema";
import { getCurrentDailyStatus, getTodayUtc, MAX_DAILY_ATTEMPTS } from "../lib/daily";
import { logger } from "../lib/logger";

const router = Router();

router.get("/daily/status", (_req, res): void => {
  const { today, dayIndex, category, nextResetAt } = getCurrentDailyStatus();
  res.json({ date: today, dayIndex, category_tr: category.tr, category_en: category.en, nextResetAt });
});

router.get("/daily/leaderboard", async (_req, res): Promise<void> => {
  const today = getTodayUtc();
  try {
    const rows = await db
      .select({
        userId: dailyScoresTable.userId,
        username: usersTable.username,
        bestScore: sql<number>`MAX(${dailyScoresTable.score})`,
      })
      .from(dailyScoresTable)
      .innerJoin(usersTable, eq(dailyScoresTable.userId, usersTable.id))
      .where(eq(dailyScoresTable.date, today))
      .groupBy(dailyScoresTable.userId, usersTable.username)
      .orderBy(desc(sql`MAX(${dailyScoresTable.score})`), asc(sql`MIN(${dailyScoresTable.createdAt})`))
      .limit(10);

    res.json(rows.map((r, i) => ({ rank: i + 1, username: r.username, bestScore: r.bestScore })));
  } catch (err) {
    logger.error({ err }, "Daily leaderboard error");
    res.status(500).json({ error: "Server error." });
  }
});

router.get("/daily/my-status", async (req, res): Promise<void> => {
  const userId = req.session.userId;
  if (!userId) {
    res.status(401).json({ error: "Not logged in." });
    return;
  }
  const today = getTodayUtc();
  try {
    const rows = await db
      .select({ score: dailyScoresTable.score, attemptNumber: dailyScoresTable.attemptNumber })
      .from(dailyScoresTable)
      .where(and(eq(dailyScoresTable.userId, userId), eq(dailyScoresTable.date, today)))
      .orderBy(desc(dailyScoresTable.attemptNumber));

    const attemptsUsed = rows.length;
    const bestScore = rows.length > 0 ? Math.max(...rows.map((r) => r.score)) : null;
    res.json({ attemptsUsed, attemptsLeft: Math.max(0, MAX_DAILY_ATTEMPTS - attemptsUsed), bestScore });
  } catch (err) {
    logger.error({ err }, "Daily my-status error");
    res.status(500).json({ error: "Server error." });
  }
});

router.post("/daily/submit", async (req, res): Promise<void> => {
  const userId = req.session.userId;
  if (!userId) {
    res.status(401).json({ error: "Not logged in." });
    return;
  }
  const { score } = req.body ?? {};
  if (typeof score !== "number" || score < 0) {
    res.status(400).json({ error: "score required." });
    return;
  }

  const today = getTodayUtc();
  try {
    const existing = await db
      .select({ score: dailyScoresTable.score, attemptNumber: dailyScoresTable.attemptNumber })
      .from(dailyScoresTable)
      .where(and(eq(dailyScoresTable.userId, userId), eq(dailyScoresTable.date, today)))
      .orderBy(desc(dailyScoresTable.attemptNumber));

    const attemptsUsed = existing.length;
    if (attemptsUsed >= MAX_DAILY_ATTEMPTS) {
      const bestScore = Math.max(...existing.map((r) => r.score));
      res.json({ saved: false, attemptsLeft: 0, bestScore });
      return;
    }

    const attemptNumber = attemptsUsed + 1;
    await db.insert(dailyScoresTable).values({
      id: randomUUID(),
      userId,
      date: today,
      score,
      attemptNumber,
    });

    const allScores = [...existing.map((r) => r.score), score];
    const bestScore = Math.max(...allScores);
    const attemptsLeft = MAX_DAILY_ATTEMPTS - attemptNumber;

    // Compute rank on leaderboard (using best score per user)
    const leaderboard = await db
      .select({ userId: dailyScoresTable.userId, bestScore: sql<number>`MAX(${dailyScoresTable.score})` })
      .from(dailyScoresTable)
      .where(eq(dailyScoresTable.date, today))
      .groupBy(dailyScoresTable.userId)
      .orderBy(desc(sql`MAX(${dailyScoresTable.score})`));

    const rank = leaderboard.findIndex((r) => r.userId === userId) + 1;

    res.json({ saved: true, attemptsLeft, bestScore, rank });
  } catch (err) {
    logger.error({ err }, "Daily submit error");
    res.status(500).json({ error: "Server error." });
  }
});

export default router;
