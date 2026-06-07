import { pgTable, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const roomsTable = pgTable("rooms", {
  code: text("code").primaryKey(),
  mode: text("mode").notNull(),
  hostId: text("host_id").notNull(),
  language: text("language").notNull().default("en"),
  category: text("category").notNull(),
  subcategory: text("subcategory").notNull().default(""),
  status: text("status").notNull().default("waiting"),
  players: jsonb("players").notNull().default([]),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertRoomSchema = createInsertSchema(roomsTable).omit({
  createdAt: true,
  updatedAt: true,
});

export type InsertRoom = z.infer<typeof insertRoomSchema>;
export type Room = typeof roomsTable.$inferSelect;
