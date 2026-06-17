import { pgTable, text, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const eloGamesTable = pgTable("elo_games", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  mode: text("mode").notNull(),
  delta: integer("delta").notNull(),
  eloAfter: integer("elo_after").notNull(),
  roomCode: text("room_code").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertEloGameSchema = createInsertSchema(eloGamesTable).omit({
  createdAt: true,
});

export type InsertEloGame = z.infer<typeof insertEloGameSchema>;
export type EloGame = typeof eloGamesTable.$inferSelect;
