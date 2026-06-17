import { Router } from "express";
import { randomUUID } from "crypto";
import { db } from "@workspace/db";
import { usersTable, eloGamesTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { soloEloDelta } from "../lib/elo";
import { logger } from "../lib/logger";

const router = Router();

/**
 * Record a solo-mode Elo change.
 * Body: { answerCount: number, roomCode: string, isCustom: boolean }
 */
router.post("/elo/record-solo", async (req, res): Promise<void> => {
  const userId = req.session.userId;
  if (!userId) {
    res.status(401).json({ error: "Not logged in." });
    return;
  }
  const { answerCount, roomCode, isCustom } = req.body ?? {};
  if (typeof answerCount !== "number") {
    res.status(400).json({ error: "answerCount required." });
    return;
  }
  if (isCustom) {
    res.json({ delta: 0, eloAfter: null, skipped: true });
    return;
  }
  try {
    const rows = await db.select().from(usersTable).where(eq(usersTable.id, userId));
    const user = rows[0];
    if (!user) {
      res.status(404).json({ error: "User not found." });
      return;
    }
    const delta = soloEloDelta(user.elo, answerCount);
    const eloAfter = Math.max(0, user.elo + delta);
    await db.update(usersTable).set({ elo: eloAfter }).where(eq(usersTable.id, userId));
    await db.insert(eloGamesTable).values({
      id: randomUUID(),
      userId,
      mode: "solo",
      delta,
      eloAfter,
      roomCode: roomCode ?? "SOLO",
    });
    res.json({ delta, eloAfter });
  } catch (err) {
    logger.error({ err }, "Record solo Elo error");
    res.status(500).json({ error: "Server error." });
  }
});

export default router;
