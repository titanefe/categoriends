import { pgTable, text, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const dailyScoresTable = pgTable("daily_scores", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  date: text("date").notNull(),
  score: integer("score").notNull(),
  attemptNumber: integer("attempt_number").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertDailyScoreSchema = createInsertSchema(dailyScoresTable).omit({
  createdAt: true,
});

export type InsertDailyScore = z.infer<typeof insertDailyScoreSchema>;
export type DailyScore = typeof dailyScoresTable.$inferSelect;
