import { Router } from "express";
import { randomUUID } from "crypto";
import { db } from "@workspace/db";
import { usersTable, eloGamesTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { soloEloDelta } from "../lib/elo";
import { logger } from "../lib/logger";

const router = Router();

/**
 * Issue a one-time token for a solo game.
 * The token is stored in the session and must be presented to record-solo.
 * This prevents replaying the same result multiple times.
 */
router.post("/elo/solo-token", (req, res): void => {
  const userId = req.session.userId;
  if (!userId) {
    res.status(401).json({ error: "Not logged in." });
    return;
  }
  const token = randomUUID();
  req.session.soloToken = token;
  req.session.save((err) => {
    if (err) {
      logger.error({ err }, "Failed to save solo token to session");
      res.status(500).json({ error: "Server error." });
      return;
    }
    res.json({ token });
  });
});

/**
 * Record a solo-mode Elo change.
 * Body: { answerCount: number, roomCode: string, isCustom: boolean, token: string }
 * Requires a valid one-time token issued by /api/elo/solo-token.
 */
router.post("/elo/record-solo", async (req, res): Promise<void> => {
  const userId = req.session.userId;
  if (!userId) {
    res.status(401).json({ error: "Not logged in." });
    return;
  }
  const { answerCount, roomCode, isCustom, token } = req.body ?? {};

  if (!token || typeof token !== "string" || token !== req.session.soloToken) {
    res.status(400).json({ error: "Invalid or expired game token." });
    return;
  }

  if (typeof answerCount !== "number") {
    res.status(400).json({ error: "answerCount required." });
    return;
  }

  if (isCustom) {
    req.session.soloToken = undefined;
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
    req.session.soloToken = undefined;
    res.json({ delta, eloAfter });
  } catch (err) {
    logger.error({ err }, "Record solo Elo error");
    res.status(500).json({ error: "Server error." });
  }
});

export default router;
