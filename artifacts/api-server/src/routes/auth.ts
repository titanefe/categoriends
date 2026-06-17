import { Router } from "express";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";

const router = Router();

router.post("/auth/register", async (req, res): Promise<void> => {
  const { username, password } = req.body ?? {};
  if (!username || typeof username !== "string" || username.trim().length < 2) {
    res.status(400).json({ error: "Username must be at least 2 characters." });
    return;
  }
  if (!password || typeof password !== "string" || password.length < 4) {
    res.status(400).json({ error: "Password must be at least 4 characters." });
    return;
  }
  const clean = username.trim().toLowerCase();
  try {
    const existing = await db.select().from(usersTable).where(eq(usersTable.username, clean));
    if (existing.length > 0) {
      res.status(409).json({ error: "Username already taken." });
      return;
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const id = randomUUID();
    await db.insert(usersTable).values({ id, username: clean, passwordHash, elo: 1000 });
    req.session.userId = id;
    res.json({ id, username: clean, elo: 1000 });
  } catch (err) {
    logger.error({ err }, "Register error");
    res.status(500).json({ error: "Server error." });
  }
});

router.post("/auth/login", async (req, res): Promise<void> => {
  const { username, password } = req.body ?? {};
  if (!username || !password) {
    res.status(400).json({ error: "Username and password required." });
    return;
  }
  const clean = username.trim().toLowerCase();
  try {
    const rows = await db.select().from(usersTable).where(eq(usersTable.username, clean));
    const user = rows[0];
    if (!user) {
      res.status(401).json({ error: "Invalid credentials." });
      return;
    }
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      res.status(401).json({ error: "Invalid credentials." });
      return;
    }
    req.session.userId = user.id;
    res.json({ id: user.id, username: user.username, elo: user.elo });
  } catch (err) {
    logger.error({ err }, "Login error");
    res.status(500).json({ error: "Server error." });
  }
});

router.post("/auth/logout", (req, res): void => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

router.get("/auth/me", async (req, res): Promise<void> => {
  const userId = req.session.userId;
  if (!userId) {
    res.json({ user: null });
    return;
  }
  try {
    const rows = await db.select().from(usersTable).where(eq(usersTable.id, userId));
    const user = rows[0];
    if (!user) {
      req.session.destroy(() => {});
      res.json({ user: null });
      return;
    }
    res.json({ user: { id: user.id, username: user.username, elo: user.elo } });
  } catch (err) {
    logger.error({ err }, "Auth me error");
    res.status(500).json({ error: "Server error." });
  }
});

export default router;
