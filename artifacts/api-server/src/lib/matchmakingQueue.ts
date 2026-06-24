import type { WebSocket } from "ws";

export type QueueMode = "duel" | "party4";
export type QueueLang = "en" | "tr";

export interface QueueEntry {
  playerId: string;
  playerName: string;
  language: QueueLang;
  ws: WebSocket;
}

// Key: `${mode}:${language}` e.g. "duel:en", "party4:tr"
const queues = new Map<string, QueueEntry[]>();

function key(mode: QueueMode, lang: QueueLang): string {
  return `${mode}:${lang}`;
}

function required(mode: QueueMode): number {
  return mode === "duel" ? 2 : 4;
}

export function joinQueue(
  mode: QueueMode,
  lang: QueueLang,
  entry: QueueEntry,
): QueueEntry[] {
  const k = key(mode, lang);
  if (!queues.has(k)) queues.set(k, []);
  const q = queues.get(k)!;
  // Prevent double-join
  if (!q.find((e) => e.playerId === entry.playerId)) {
    q.push(entry);
  }
  return q;
}

export function leaveQueue(
  mode: QueueMode,
  lang: QueueLang,
  playerId: string,
): QueueEntry[] {
  const k = key(mode, lang);
  const q = queues.get(k) ?? [];
  const next = q.filter((e) => e.playerId !== playerId);
  queues.set(k, next);
  return next;
}

export function leaveAllQueues(playerId: string): void {
  for (const [k, q] of queues) {
    const next = q.filter((e) => e.playerId !== playerId);
    queues.set(k, next);
  }
}

export function getQueue(mode: QueueMode, lang: QueueLang): QueueEntry[] {
  return queues.get(key(mode, lang)) ?? [];
}

export function isQueueFull(mode: QueueMode, lang: QueueLang): boolean {
  return (queues.get(key(mode, lang))?.length ?? 0) >= required(mode);
}

export function popMatch(
  mode: QueueMode,
  lang: QueueLang,
): QueueEntry[] | null {
  const k = key(mode, lang);
  const q = queues.get(k) ?? [];
  const req = required(mode);
  if (q.length < req) return null;
  const matched = q.splice(0, req);
  queues.set(k, q);
  return matched;
}

export function getRequired(mode: QueueMode): number {
  return required(mode);
}
