import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "http";
import type { Request, Response } from "express";
import type { Server } from "http";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { usersTable, eloGamesTable } from "@workspace/db/schema";
import {
  createRoom,
  getRoom,
  updateRoom,
  deleteRoom,
  addPlayerToRoom,
  removePlayerFromRoom,
  getNextPlayer,
  type Player,
  type Room,
} from "./roomStore";
import {
  joinQueue,
  leaveQueue,
  leaveAllQueues,
  getQueue,
  isQueueFull,
  popMatch,
  getRequired,
  type QueueMode,
  type QueueLang,
} from "./matchmakingQueue";
import { SUBCATEGORY_POOLS, CATEGORY_TO_KEY } from "./subcategoryPools";
import { openai } from "./openai";
import { duelEloDelta, partyEloDeltas } from "./elo";
import { logger } from "./logger";
import { sessionMiddleware, isOriginAllowed } from "../app";
import {
  isBotId,
  createBotState,
  getBotState,
  generateBotAnswer,
  verifyBotAnswer,
  botHasAnswersLeft,
  incrementBotAnswers,
  randomBotName,
  removeBotState,
} from "./botPlayer";

interface ExtWebSocket extends WebSocket {
  roomCode?: string;
  playerId?: string;
  /** userId resolved from the session cookie at connection time */
  sessionUserId?: string | null;
}

type WSMessage =
  | { type: "create_room"; hostId: string; playerName: string; mode: Room["mode"]; language: Room["language"]; category: string; timeSeconds?: number; impossibleMode?: boolean }
  | { type: "join"; roomCode: string; playerId: string; playerName: string; language?: string }
  | { type: "rejoin"; roomCode: string; playerId: string }
  | { type: "ping" }
  | { type: "start_game"; roomCode: string; subcategory: string; customSubcategory?: boolean }
  | { type: "answer_submitted"; roomCode: string; playerId: string; answer: string; valid: boolean; reason: string }
  | { type: "player_eliminated"; roomCode: string; playerId: string }
  | { type: "next_turn"; roomCode: string }
  | { type: "game_over_request"; roomCode: string; winnerId: string; winnerName: string }
  | { type: "reset_room"; roomCode: string }
  | { type: "update_room_settings"; roomCode: string; playerId: string; category: string; timeSeconds: number; impossibleMode?: boolean }
  | { type: "kick_player"; roomCode: string; hostId: string; targetId: string }
  | { type: "leave_game"; roomCode: string; playerId: string }
  | { type: "leave_room"; roomCode: string; playerId: string }
  | { type: "join_queue"; mode: QueueMode; language: QueueLang; playerId: string; playerName: string }
  | { type: "leave_queue"; mode: QueueMode; language: QueueLang; playerId: string };

const roomSockets = new Map<string, Set<ExtWebSocket>>();

const turnTimers = new Map<string, ReturnType<typeof setTimeout>>();
const disconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
// Key: playerId waiting in duel queue. Fires after 15s to spawn a bot match.
const queueBotTimers = new Map<string, ReturnType<typeof setTimeout>>();
const lobbyIntervals = new Map<string, ReturnType<typeof setInterval>>();
const currentTurnStartedAt = new Map<string, number>();

function clearTurnTimer(roomCode: string): void {
  const t = turnTimers.get(roomCode);
  if (t !== undefined) { clearTimeout(t); turnTimers.delete(roomCode); }
}

function clearDisconnectTimer(roomCode: string, playerId: string): void {
  const key = `${roomCode}:${playerId}`;
  const t = disconnectTimers.get(key);
  if (t !== undefined) { clearTimeout(t); disconnectTimers.delete(key); }
}

function clearLobbyInterval(roomCode: string): void {
  const i = lobbyIntervals.get(roomCode);
  if (i !== undefined) { clearInterval(i); lobbyIntervals.delete(roomCode); }
}

function startLobbyInterval(roomCode: string): void {
  clearLobbyInterval(roomCode);
  const interval = setInterval(() => {
    const r = getRoom(roomCode);
    if (!r || r.status !== "waiting") { clearLobbyInterval(roomCode); return; }
    broadcastAll(roomCode, { type: "lobby_sync", room: r });
  }, 3_000);
  lobbyIntervals.set(roomCode, interval);
}

/** Apply a valid answer server-side (used for bot turns). */
function applyBotAnswer(roomCode: string, botId: string, answer: string): void {
  const room = getRoom(roomCode);
  if (!room || room.status !== "playing" || room.currentPlayerId !== botId) return;

  clearTurnTimer(roomCode);
  const answers = [...room.acceptedAnswers, answer];
  const player = room.players.find((p) => p.id === botId);
  if (player) player.score += 1;

  const nextPlayerId = getNextPlayer(room);
  updateRoom(roomCode, { acceptedAnswers: answers, currentPlayerId: nextPlayerId, players: room.players });

  const ts = Date.now();
  currentTurnStartedAt.set(roomCode, ts);
  broadcastAll(roomCode, {
    type: "answer_result",
    playerId: botId,
    answer,
    valid: true,
    reason: "",
  });
  broadcastAll(roomCode, {
    type: "turn_passed",
    nextPlayerId,
    turnStartedAt: ts,
    room: getRoom(roomCode),
  });
  if (nextPlayerId) scheduleTurnTimeout(roomCode, nextPlayerId);
  if (nextPlayerId && isBotId(nextPlayerId)) scheduleBotTurn(roomCode, nextPlayerId);
}

/** Schedule a bot's next turn after a random 8–12s delay. */
function scheduleBotTurn(roomCode: string, botId: string): void {
  const delayMs = (8 + Math.random() * 4) * 1000; // 8–12s
  setTimeout(() => {
    const room = getRoom(roomCode);
    if (!room || room.status !== "playing" || room.currentPlayerId !== botId) return;

    const state = getBotState(botId);
    if (!state) return;

    void (async () => {
      // 1. Generate a candidate answer
      const answer = await generateBotAnswer(state, room.acceptedAnswers);
      if (!answer) return;

      // Re-check after async generate
      const r = getRoom(roomCode);
      if (!r || r.status !== "playing" || r.currentPlayerId !== botId) return;

      // 2. Verify through the same judge as real players
      const { valid, reason } = await verifyBotAnswer(answer, state.subcategory, r.acceptedAnswers, state.language);

      // Re-check after async verify
      const r2 = getRoom(roomCode);
      if (!r2 || r2.status !== "playing" || r2.currentPlayerId !== botId) return;

      if (valid && botHasAnswersLeft(botId)) {
        // Valid answer within quota: clear timer, update room, advance turn
        incrementBotAnswers(botId);
        applyBotAnswer(roomCode, botId, answer);
      } else {
        // Quota exhausted OR invalid answer: eliminate bot like a real player
        // Invalid answer: broadcast result then eliminate bot — same flow as real player invalid
        broadcastAll(roomCode, { type: "answer_result", playerId: botId, answer, valid: false, reason });

        clearTurnTimer(roomCode);
        const player = r2.players.find((p) => p.id === botId);
        if (!player || player.eliminated) return;
        player.eliminated = true;
        r2.eliminationOrder.push(botId);
        updateRoom(roomCode, { players: r2.players, eliminationOrder: r2.eliminationOrder });

        if (!checkAndEndGame(roomCode)) {
          const nextPlayerId = getNextPlayer(r2);
          updateRoom(roomCode, { currentPlayerId: nextPlayerId });
          const ts = Date.now();
          currentTurnStartedAt.set(roomCode, ts);
          broadcastAll(roomCode, { type: "player_eliminated", playerId: botId, nextPlayerId, turnStartedAt: ts, room: getRoom(roomCode) });
          if (nextPlayerId) scheduleTurnTimeout(roomCode, nextPlayerId);
        }
      }
    })();
  }, delayMs);
}

/** Called 10s after a human joins a duel queue with no real match. Creates a bot opponent. */
async function spawnBotMatch(
  humanPlayerId: string,
  humanPlayerName: string,
  humanUserId: string | null,
  humanElo: number,
  humanWs: ExtWebSocket,
  language: QueueLang,
): Promise<void> {
  // Remove human from queue so a real player can't also match them
  leaveQueue("duel", language, humanPlayerId);

  // Pick category + subcategory
  const QUICK_CATEGORIES_EN = ["Animals", "Film & TV", "Music", "Food & Drink", "Sports", "Games", "Geography", "Science"];
  const QUICK_CATEGORIES_TR = ["Hayvanlar", "Film & Dizi", "Müzik", "Yiyecek & İçecek", "Spor", "Oyunlar", "Coğrafya", "Bilim"];
  const catEnKeys = ["Animals", "Film & TV", "Music", "Food & Drink", "Sports", "Games", "Geography", "Science"];
  const cats = language === "tr" ? QUICK_CATEGORIES_TR : QUICK_CATEGORIES_EN;
  const randomIdx = Math.floor(Math.random() * cats.length);
  const category = cats[randomIdx];
  const categoryKey = catEnKeys[randomIdx];
  const poolKey = CATEGORY_TO_KEY[categoryKey] ?? categoryKey;
  const pool = SUBCATEGORY_POOLS[poolKey];
  const poolOptions: string[] = pool ? (language === "tr" ? pool.tr : pool.en) : [];
  let subcategory = poolOptions.length > 0
    ? poolOptions[Math.floor(Math.random() * poolOptions.length)]
    : category;
  try {
    if (poolOptions.length > 0 && Math.random() >= 0.5) {
      const poolList = poolOptions.join(", ");
      const systemPrompt = language === "tr"
        ? `Sen bir kelime oyunu asistanısın. "${category}" kategorisi için GENİŞ ve BASİT bir alt kategori üret. Kısa (2-4 kelime), oynanabilir olmalı. Sadece alt kategoriyi yaz. Mevcut liste (tekrar ETME): ${poolList}`
        : `You are a word game assistant. Generate a BROAD, SIMPLE sub-category for "${category}". Keep it short (2-4 words), playable. Output ONLY the sub-category name. Existing list (do NOT repeat): ${poolList}`;
      const userPrompt = language === "tr"
        ? `"${category}" için listede olmayan yeni bir alt kategori üret.`
        : `Generate a fresh sub-category for "${category}" not in the existing list.`;
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini", max_tokens: 30, temperature: 1.2,
        messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
      });
      subcategory = completion.choices[0]?.message?.content?.trim() ?? subcategory;
    }
  } catch { /* use pool pick */ }

  // Create bot ID + name
  const botId = `bot_${randomUUID()}`;
  const botName = randomBotName(language);
  const botElo = 800 + Math.floor(Math.random() * 400); // 800–1200

  // Create room with human as host
  const room = createRoom(humanPlayerId, "duel", language, category, 15, false, true);
  roomSockets.set(room.code, new Set());

  // Add human player
  addPlayerToRoom(room.code, { id: humanPlayerId, name: humanPlayerName, score: 0, eliminated: false, userId: humanUserId, elo: humanElo });
  humanWs.roomCode = room.code;
  humanWs.playerId = humanPlayerId;
  roomSockets.get(room.code)!.add(humanWs);

  // Add bot player (no socket — bot never joins the socket set)
  addPlayerToRoom(room.code, { id: botId, name: botName, score: 0, eliminated: false, userId: null, elo: botElo });

  // Create bot state
  createBotState(botId, room.code, language, category, subcategory);

  // Shuffle turn order
  const turnOrder = [humanPlayerId, botId];
  if (Math.random() < 0.5) turnOrder.reverse();
  const firstPlayerId = turnOrder[0];

  updateRoom(room.code, {
    status: "playing",
    subcategory,
    customSubcategory: false,
    acceptedAnswers: [],
    turnOrder,
    currentPlayerId: firstPlayerId,
    eliminationOrder: [],
  });

  const tsStart = Date.now();
  currentTurnStartedAt.set(room.code, tsStart);

  broadcastAll(room.code, {
    type: "match_found",
    room: getRoom(room.code),
    subcategory,
    firstPlayerId,
    turnStartedAt: tsStart,
  });

  scheduleTurnTimeout(room.code, firstPlayerId);
  if (isBotId(firstPlayerId)) scheduleBotTurn(room.code, firstPlayerId);
}

function scheduleTurnTimeout(roomCode: string, playerId: string): void {
  const room = getRoom(roomCode);
  if (!room || room.status !== "playing") return;
  const delayMs = (room.timeSeconds + 2) * 1000;
  clearTurnTimer(roomCode);
  const timer = setTimeout(() => {
    turnTimers.delete(roomCode);
    const r = getRoom(roomCode);
    if (!r || r.status !== "playing") return;
    if (r.currentPlayerId !== playerId) return;
    const p = r.players.find((pl) => pl.id === playerId);
    if (!p || p.eliminated) return;
    p.eliminated = true;
    r.eliminationOrder.push(playerId);
    updateRoom(roomCode, { players: r.players, eliminationOrder: r.eliminationOrder });
    if (!checkAndEndGame(roomCode)) {
      const next = getNextPlayer(r);
      updateRoom(roomCode, { currentPlayerId: next });
      const ts = Date.now();
      currentTurnStartedAt.set(roomCode, ts);
      broadcastAll(roomCode, {
        type: "player_eliminated",
        playerId,
        nextPlayerId: next,
        turnStartedAt: ts,
        room: getRoom(roomCode),
      });
      if (next) scheduleTurnTimeout(roomCode, next);
      if (next && isBotId(next)) scheduleBotTurn(roomCode, next);
    }
  }, delayMs);
  turnTimers.set(roomCode, timer);
}

function broadcast(roomCode: string, message: object, exclude?: ExtWebSocket): void {
  const sockets = roomSockets.get(roomCode);
  if (!sockets) return;
  const data = JSON.stringify(message);
  for (const ws of sockets) {
    if (ws !== exclude && ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  }
}

function broadcastAll(roomCode: string, message: object): void {
  broadcast(roomCode, message);
}

function sendToSocket(ws: WebSocket, message: object): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

async function persistEloDeltas(room: Room, deltaMap: Map<string, number>): Promise<void> {
  for (const p of room.players) {
    if (!p.userId) continue;
    const delta = deltaMap.get(p.id) ?? 0;
    try {
      const rows = await db.select().from(usersTable).where(eq(usersTable.id, p.userId));
      const user = rows[0];
      if (!user) continue;
      const eloAfter = Math.max(0, user.elo + delta);
      await db.update(usersTable).set({ elo: eloAfter }).where(eq(usersTable.id, p.userId));
      await db.insert(eloGamesTable).values({
        id: randomUUID(),
        userId: p.userId,
        mode: room.mode,
        delta,
        eloAfter,
        roomCode: room.code,
      });
    } catch (err) {
      logger.error({ err }, "Elo persist error");
    }
  }
}

function checkAndEndGame(roomCode: string): boolean {
  const room = getRoom(roomCode);
  if (!room || room.status !== "playing") return false;
  const activePlayers = room.players.filter((p) => !p.eliminated);
  if (activePlayers.length <= 1) {
    const winner = activePlayers[0] ?? null;
    updateRoom(roomCode, { status: "finished" });
    const scores = room.players.map((p) => ({ id: p.id, name: p.name, score: p.score }));

    const eloDeltas: Record<string, number> = {};
    const playersWithUserId = room.players.filter((p) => p.userId);
    if (playersWithUserId.length >= 1 && room.players.length >= 2 && !room.customSubcategory) {
      // Build rank from actual elimination order.
      // winner = rank 1, last eliminated = rank 2, ..., first eliminated = rank N.
      // eliminationOrder[0] = first eliminated (worst), eliminationOrder[last] = last eliminated (2nd best).
      const rankOrder: string[] = winner
        ? [winner.id, ...[...room.eliminationOrder].reverse()]
        : [...room.eliminationOrder].reverse();

      const guestIds = new Set(room.players.filter((p) => !p.userId).map((p) => p.id));
      let deltaMap: Map<string, number>;
      if (room.mode === "duel" && room.players.length === 2) {
        const winnerId = rankOrder[0];
        const loserId = rankOrder[1];
        const winnerPlayer = room.players.find((p) => p.id === winnerId);
        const loserPlayer = room.players.find((p) => p.id === loserId);
        if (winnerPlayer && loserPlayer) {
          deltaMap = new Map([
            [winnerId, duelEloDelta(winnerPlayer.elo, loserPlayer.elo, true, room.timeSeconds, guestIds.has(loserId))],
            [loserId, duelEloDelta(loserPlayer.elo, winnerPlayer.elo, false, room.timeSeconds, guestIds.has(winnerId))],
          ]);
        } else {
          deltaMap = new Map();
        }
      } else {
        deltaMap = partyEloDeltas(
          rankOrder.map((id, idx) => {
            const p = room.players.find((pl) => pl.id === id)!;
            return { id, elo: p.elo, rank: idx + 1 };
          }),
          room.timeSeconds,
          guestIds,
        );
      }
      for (const [id, delta] of deltaMap) {
        const p = room.players.find((pl) => pl.id === id);
        if (p?.userId) eloDeltas[id] = delta;
      }
      void persistEloDeltas(room, deltaMap);
    }

    broadcastAll(roomCode, {
      type: "game_over",
      winnerId: winner?.id ?? null,
      winnerName: winner?.name ?? "Nobody",
      scores,
      eloDeltas,
    });
    return true;
  }
  return false;
}

export function setupWebSocket(server: Server): WebSocketServer {
  const wss = new WebSocketServer({
    server,
    path: "/ws",
    // Reject connections opened from other websites (the session cookie is
    // shared across *.categoriends.com, so only our own site may use it).
    verifyClient: ({ origin }: { origin?: string }) => isOriginAllowed(origin),
  });

  wss.on("connection", (ws: ExtWebSocket, req: IncomingMessage) => {
    logger.info({ ip: req.socket.remoteAddress }, "WS client connected");

    // Resolve the authenticated user from the session cookie.
    // sessionMiddleware populates req.session; we store userId on the socket
    // so all message handlers can trust it without accepting it from the client.
    (sessionMiddleware as unknown as (req: Request, res: Response, next: () => void) => void)(
      req as unknown as Request,
      {} as unknown as Response,
      () => {
        ws.sessionUserId = (req as unknown as Request).session?.userId ?? null;
      },
    );

    ws.on("message", (data) => {
      let msg: WSMessage;
      try {
        msg = JSON.parse(data.toString()) as WSMessage;
      } catch {
        logger.warn("Invalid WS message");
        return;
      }

      switch (msg.type) {
        case "create_room": {
          void (async () => {
            // Resolve identity from session — never trust client-supplied userId/elo
            const userId = ws.sessionUserId ?? null;
            let elo = 1000;
            if (userId) {
              try {
                const rows = await db.select({ elo: usersTable.elo }).from(usersTable).where(eq(usersTable.id, userId));
                elo = rows[0]?.elo ?? 1000;
              } catch { /* use default */ }
            }

            const room = createRoom(msg.hostId, msg.mode, msg.language, msg.category, msg.timeSeconds ?? 15, msg.impossibleMode ?? false);
            const player: Player = {
              id: msg.hostId,
              name: msg.playerName,
              score: 0,
              eliminated: false,
              userId,
              elo,
            };
            addPlayerToRoom(room.code, player);
            ws.roomCode = room.code;
            ws.playerId = msg.hostId;

            if (!roomSockets.has(room.code)) {
              roomSockets.set(room.code, new Set());
            }
            roomSockets.get(room.code)!.add(ws);

            sendToSocket(ws, {
              type: "room_created",
              room: getRoom(room.code),
            });

            startLobbyInterval(room.code);
          })();
          break;
        }

        case "join": {
          const room = getRoom(msg.roomCode);
          if (!room) {
            sendToSocket(ws, { type: "error", message: "Room not found" });
            return;
          }
          if (room.status !== "waiting") {
            sendToSocket(ws, { type: "error", message: "Game already started" });
            return;
          }
          if (room.mode === "duel" && room.players.length >= 2) {
            sendToSocket(ws, { type: "error", message: "room_full" });
            return;
          }
          if (msg.language && msg.language !== room.language) {
            sendToSocket(ws, { type: "error", message: "wrong_language" });
            return;
          }

          void (async () => {
            // Resolve identity from session — never trust client-supplied userId/elo
            const userId = ws.sessionUserId ?? null;
            let elo = 1000;
            if (userId) {
              try {
                const rows = await db.select({ elo: usersTable.elo }).from(usersTable).where(eq(usersTable.id, userId));
                elo = rows[0]?.elo ?? 1000;
              } catch { /* use default */ }
            }

            const player: Player = {
              id: msg.playerId,
              name: msg.playerName,
              score: 0,
              eliminated: false,
              userId,
              elo,
            };

            ws.roomCode = msg.roomCode;
            ws.playerId = msg.playerId;

            if (!roomSockets.has(msg.roomCode)) {
              roomSockets.set(msg.roomCode, new Set());
            }
            roomSockets.get(msg.roomCode)!.add(ws);

            addPlayerToRoom(msg.roomCode, player);

            sendToSocket(ws, {
              type: "room_state",
              room: getRoom(msg.roomCode),
            });

            broadcastAll(msg.roomCode, {
              type: "lobby_sync",
              room: getRoom(msg.roomCode),
            });

            startLobbyInterval(msg.roomCode);
          })();
          break;
        }

        case "start_game": {
          const room = getRoom(msg.roomCode);
          if (!room) return;

          clearLobbyInterval(msg.roomCode);

          const turnOrder = [...room.players.map((p) => p.id)];
          for (let i = turnOrder.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [turnOrder[i], turnOrder[j]] = [turnOrder[j], turnOrder[i]];
          }
          const firstPlayerId = turnOrder[0] ?? null;

          updateRoom(msg.roomCode, {
            status: "playing",
            subcategory: msg.subcategory,
            customSubcategory: msg.customSubcategory ?? false,
            acceptedAnswers: [],
            turnOrder,
            currentPlayerId: firstPlayerId,
            eliminationOrder: [],
          });

          const tsStart = Date.now();
          currentTurnStartedAt.set(msg.roomCode, tsStart);
          broadcastAll(msg.roomCode, {
            type: "game_started",
            subcategory: msg.subcategory,
            firstPlayerId,
            turnStartedAt: tsStart,
            room: getRoom(msg.roomCode),
          });
          if (firstPlayerId) scheduleTurnTimeout(msg.roomCode, firstPlayerId);
          break;
        }

        case "answer_submitted": {
          const room = getRoom(msg.roomCode);
          if (!room) return;

          broadcastAll(msg.roomCode, {
            type: "answer_result",
            playerId: msg.playerId,
            answer: msg.answer,
            valid: msg.valid,
            reason: msg.reason,
          });

          if (msg.valid) {
            clearTurnTimer(msg.roomCode);
            const answers = [...room.acceptedAnswers, msg.answer];
            const player = room.players.find((p) => p.id === msg.playerId);
            if (player) player.score += 1;

            const nextPlayerId = getNextPlayer(room);
            const roomUpdates: Partial<Room> = {
              acceptedAnswers: answers,
              currentPlayerId: nextPlayerId,
              players: room.players,
            };
            if (room.impossibleMode) {
              roomUpdates.timeSeconds = Math.max(7, room.timeSeconds - 1);
            }
            updateRoom(msg.roomCode, roomUpdates);

            const tsTurnPassed = Date.now();
            currentTurnStartedAt.set(msg.roomCode, tsTurnPassed);
            broadcastAll(msg.roomCode, {
              type: "turn_passed",
              nextPlayerId,
              turnStartedAt: tsTurnPassed,
              room: getRoom(msg.roomCode),
            });
            if (nextPlayerId) scheduleTurnTimeout(msg.roomCode, nextPlayerId);
            if (nextPlayerId && isBotId(nextPlayerId)) scheduleBotTurn(msg.roomCode, nextPlayerId);
          }
          break;
        }

        case "player_eliminated": {
          const room = getRoom(msg.roomCode);
          if (!room || room.status !== "playing") return;

          if (room.currentPlayerId !== msg.playerId) return;

          const player = room.players.find((p) => p.id === msg.playerId);
          if (!player || player.eliminated) return;

          clearTurnTimer(msg.roomCode);
          player.eliminated = true;
          room.eliminationOrder.push(msg.playerId);
          updateRoom(msg.roomCode, { players: room.players, eliminationOrder: room.eliminationOrder });

          if (checkAndEndGame(msg.roomCode)) break;

          const nextPlayerId = getNextPlayer(room);
          updateRoom(msg.roomCode, { currentPlayerId: nextPlayerId });

          const tsElim = Date.now();
          currentTurnStartedAt.set(msg.roomCode, tsElim);
          broadcastAll(msg.roomCode, {
            type: "player_eliminated",
            playerId: msg.playerId,
            nextPlayerId,
            turnStartedAt: tsElim,
            room: getRoom(msg.roomCode),
          });
          if (nextPlayerId) scheduleTurnTimeout(msg.roomCode, nextPlayerId);
          if (nextPlayerId && isBotId(nextPlayerId)) scheduleBotTurn(msg.roomCode, nextPlayerId);
          break;
        }

        case "next_turn": {
          const room = getRoom(msg.roomCode);
          if (!room) return;
          clearTurnTimer(msg.roomCode);
          const nextPlayerId = getNextPlayer(room);
          updateRoom(msg.roomCode, { currentPlayerId: nextPlayerId });
          const tsNextTurn = Date.now();
          currentTurnStartedAt.set(msg.roomCode, tsNextTurn);
          broadcastAll(msg.roomCode, {
            type: "turn_passed",
            nextPlayerId,
            turnStartedAt: tsNextTurn,
            room: getRoom(msg.roomCode),
          });
          if (nextPlayerId) scheduleTurnTimeout(msg.roomCode, nextPlayerId);
          if (nextPlayerId && isBotId(nextPlayerId)) scheduleBotTurn(msg.roomCode, nextPlayerId);
          break;
        }

        case "game_over_request": {
          // Fallback end-of-game trigger (e.g. solo timer expiry redirect).
          // Eliminate all active non-winner players in score order so checkAndEndGame
          // can compute Elo from eliminationOrder correctly.
          const room = getRoom(msg.roomCode);
          if (!room || room.status !== "playing") return;
          clearTurnTimer(msg.roomCode);

          const activePlayers = room.players.filter((p) => !p.eliminated);
          const nonWinners = activePlayers
            .filter((p) => p.id !== msg.winnerId)
            .sort((a, b) => a.score - b.score); // lowest score eliminated first
          for (const p of nonWinners) {
            p.eliminated = true;
            room.eliminationOrder.push(p.id);
          }
          updateRoom(msg.roomCode, { players: room.players, eliminationOrder: room.eliminationOrder });
          checkAndEndGame(msg.roomCode);
          break;
        }

        case "reset_room": {
          const oldRoom = getRoom(msg.roomCode);
          if (!oldRoom) return;

          clearTurnTimer(msg.roomCode);

          const oldSockets = roomSockets.get(msg.roomCode);
          const connectedIds = new Set<string>();
          if (oldSockets) {
            for (const s of oldSockets) {
              if (s.playerId && s.readyState === WebSocket.OPEN) {
                connectedIds.add(s.playerId);
              }
            }
          }

          const newHostId = connectedIds.has(oldRoom.hostId)
            ? oldRoom.hostId
            : (oldRoom.players.find((p) => connectedIds.has(p.id))?.id ?? oldRoom.hostId);

          const resetTimeSeconds = oldRoom.impossibleMode ? 18 : oldRoom.timeSeconds;
          const newRoom = createRoom(
            newHostId,
            oldRoom.mode,
            oldRoom.language,
            oldRoom.category,
            resetTimeSeconds,
            oldRoom.impossibleMode,
          );
          for (const p of oldRoom.players) {
            if (connectedIds.has(p.id)) {
              addPlayerToRoom(newRoom.code, { ...p, score: 0, eliminated: false });
            }
          }

          if (oldSockets) {
            roomSockets.set(newRoom.code, new Set(oldSockets));
            roomSockets.delete(msg.roomCode);
            for (const s of oldSockets) {
              s.roomCode = newRoom.code;
            }
          }

          clearLobbyInterval(msg.roomCode);
          deleteRoom(msg.roomCode);

          broadcastAll(newRoom.code, {
            type: "room_reset",
            room: getRoom(newRoom.code),
          });

          startLobbyInterval(newRoom.code);
          break;
        }

        case "kick_player": {
          const room = getRoom(msg.roomCode);
          if (!room || room.hostId !== msg.hostId || room.status !== "waiting") return;
          const sockets = roomSockets.get(msg.roomCode);
          if (sockets) {
            for (const s of sockets) {
              if (s.playerId === msg.targetId) {
                sendToSocket(s, { type: "player_kicked" });
                break;
              }
            }
          }
          removePlayerFromRoom(msg.roomCode, msg.targetId);
          if (sockets) {
            for (const s of sockets) {
              if (s.playerId === msg.targetId) {
                sockets.delete(s);
                s.roomCode = undefined;
                s.playerId = undefined;
                break;
              }
            }
          }
          broadcastAll(msg.roomCode, {
            type: "lobby_sync",
            room: getRoom(msg.roomCode),
          });
          break;
        }

        case "leave_room": {
          const room = getRoom(msg.roomCode);
          if (!room || room.status !== "waiting") return;
          const wasHost = room.hostId === msg.playerId;
          removePlayerFromRoom(msg.roomCode, msg.playerId);
          const updated = getRoom(msg.roomCode);
          if (wasHost && updated && updated.players.length > 0) {
            updateRoom(msg.roomCode, { hostId: updated.players[0].id });
          }
          const leavingSockets = roomSockets.get(msg.roomCode);
          if (leavingSockets) {
            for (const s of leavingSockets) {
              if (s.playerId === msg.playerId) {
                leavingSockets.delete(s);
                s.roomCode = undefined;
                s.playerId = undefined;
                break;
              }
            }
          }
          broadcastAll(msg.roomCode, {
            type: "lobby_sync",
            room: getRoom(msg.roomCode),
          });
          break;
        }

        case "leave_game": {
          const room = getRoom(msg.roomCode);
          if (!room || room.status !== "playing") return;
          const leavingPlayer = room.players.find((p) => p.id === msg.playerId);
          if (!leavingPlayer || leavingPlayer.eliminated) return;

          clearTurnTimer(msg.roomCode);
          leavingPlayer.eliminated = true;
          room.eliminationOrder.push(msg.playerId);
          updateRoom(msg.roomCode, { players: room.players, eliminationOrder: room.eliminationOrder });

          if (!checkAndEndGame(msg.roomCode)) {
            const tsLeave = Date.now();
            currentTurnStartedAt.set(msg.roomCode, tsLeave);
            if (room.currentPlayerId === msg.playerId) {
              const nextPlayerId = getNextPlayer(room);
              updateRoom(msg.roomCode, { currentPlayerId: nextPlayerId });
              broadcastAll(msg.roomCode, {
                type: "player_eliminated",
                playerId: msg.playerId,
                nextPlayerId,
                turnStartedAt: tsLeave,
                room: getRoom(msg.roomCode),
              });
              if (nextPlayerId) scheduleTurnTimeout(msg.roomCode, nextPlayerId);
              if (nextPlayerId && isBotId(nextPlayerId)) scheduleBotTurn(msg.roomCode, nextPlayerId);
            } else {
              broadcastAll(msg.roomCode, {
                type: "player_eliminated",
                playerId: msg.playerId,
                nextPlayerId: room.currentPlayerId,
                turnStartedAt: tsLeave,
                room: getRoom(msg.roomCode),
              });
              if (room.currentPlayerId) scheduleTurnTimeout(msg.roomCode, room.currentPlayerId);
              if (room.currentPlayerId && isBotId(room.currentPlayerId)) scheduleBotTurn(msg.roomCode, room.currentPlayerId);
            }
          }
          break;
        }

        case "rejoin": {
          clearDisconnectTimer(msg.roomCode, msg.playerId);
          const room = getRoom(msg.roomCode);
          if (!room) { sendToSocket(ws, { type: "error", message: "Room not found" }); return; }
          const rejoiningPlayer = room.players.find((p) => p.id === msg.playerId);
          if (!rejoiningPlayer) { sendToSocket(ws, { type: "error", message: "Player not found" }); return; }
          ws.roomCode = msg.roomCode;
          ws.playerId = msg.playerId;
          if (!roomSockets.has(msg.roomCode)) roomSockets.set(msg.roomCode, new Set());
          roomSockets.get(msg.roomCode)!.add(ws);
          const tsSynced = currentTurnStartedAt.get(msg.roomCode) ?? Date.now();
          sendToSocket(ws, {
            type: "game_state_sync",
            room: getRoom(msg.roomCode),
            turnStartedAt: tsSynced,
          });
          break;
        }

        case "update_room_settings": {
          const room = getRoom(msg.roomCode);
          if (!room || room.hostId !== msg.playerId || room.status !== "waiting") return;
          updateRoom(msg.roomCode, { category: msg.category, timeSeconds: msg.timeSeconds, impossibleMode: msg.impossibleMode ?? false });
          broadcastAll(msg.roomCode, {
            type: "lobby_sync",
            room: getRoom(msg.roomCode),
          });
          break;
        }

        case "join_queue": {
          void (async () => {
            const { mode, language, playerId, playerName } = msg;

            // Resolve authenticated user
            const userId = ws.sessionUserId ?? null;
            let elo = 1000;
            if (userId) {
              try {
                const rows = await db.select({ elo: usersTable.elo }).from(usersTable).where(eq(usersTable.id, userId));
                elo = rows[0]?.elo ?? 1000;
              } catch { /* use default */ }
            }

            // Tag this socket so we can clean up on disconnect
            ws.playerId = playerId;

            joinQueue(mode, language, { playerId, playerName, language, ws, userId, elo });
            const q = getQueue(mode, language);
            const req = getRequired(mode);

            // Notify all waiting players of current count
            for (const entry of q) {
              sendToSocket(entry.ws, { type: "queue_update", count: q.length, required: req });
            }

            // Schedule a 15s bot fallback for 1v1 duel mode only
            if (mode === "duel") {
              const botTimer = setTimeout(() => {
                queueBotTimers.delete(playerId);
                void spawnBotMatch(playerId, playerName, userId, elo, ws, language);
              }, 10_000);
              queueBotTimers.set(playerId, botTimer);
            }

            // Check if we have enough players to start
            if (isQueueFull(mode, language)) {
              const matched = popMatch(mode, language);
              if (!matched) return;

              // Cancel bot timers for matched players
              for (const entry of matched) {
                const t = queueBotTimers.get(entry.playerId);
                if (t !== undefined) { clearTimeout(t); queueBotTimers.delete(entry.playerId); }
              }

              // Generate a random subcategory
              const QUICK_CATEGORIES_EN = ["Animals", "Film & TV", "Music", "Food & Drink", "Sports", "Games", "Geography", "Science"];
              const QUICK_CATEGORIES_TR = ["Hayvanlar", "Film & Dizi", "Müzik", "Yiyecek & İçecek", "Spor", "Oyunlar", "Coğrafya", "Bilim"];
              const cats = language === "tr" ? QUICK_CATEGORIES_TR : QUICK_CATEGORIES_EN;
              const catEnKeys = ["Animals", "Film & TV", "Music", "Food & Drink", "Sports", "Games", "Geography", "Science"];
              const randomIdx = Math.floor(Math.random() * cats.length);
              const category = cats[randomIdx];
              const categoryKey = catEnKeys[randomIdx];
              const poolKey = CATEGORY_TO_KEY[categoryKey] ?? categoryKey;
              const pool = SUBCATEGORY_POOLS[poolKey];
              const poolOptions: string[] = pool ? (language === "tr" ? pool.tr : pool.en) : [];

              let subcategory = poolOptions.length > 0
                ? poolOptions[Math.floor(Math.random() * poolOptions.length)]
                : category;

              // Try AI generation (non-blocking — fallback to pool on error)
              try {
                if (poolOptions.length > 0 && Math.random() >= 0.5) {
                  const poolList = poolOptions.join(", ");
                  const systemPrompt = language === "tr"
                    ? `Sen bir kelime oyunu asistanısın. "${category}" kategorisi için GENİŞ ve BASİT bir alt kategori üret. Kısa (2-4 kelime), oynanabilir olmalı. Sadece alt kategoriyi yaz. Mevcut liste (tekrar ETME): ${poolList}`
                    : `You are a word game assistant. Generate a BROAD, SIMPLE sub-category for "${category}". Keep it short (2-4 words), playable. Output ONLY the sub-category name. Existing list (do NOT repeat): ${poolList}`;
                  const userPrompt = language === "tr"
                    ? `"${category}" için listede olmayan yeni bir alt kategori üret.`
                    : `Generate a fresh sub-category for "${category}" not in the existing list.`;
                  const completion = await openai.chat.completions.create({
                    model: "gpt-4o-mini",
                    max_tokens: 30,
                    temperature: 1.2,
                    messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
                  });
                  subcategory = completion.choices[0]?.message?.content?.trim() ?? subcategory;
                }
              } catch { /* use pool pick */ }

              // Create room for matched players
              const hostId = matched[0].playerId;
              const roomMode: Room["mode"] = mode === "duel" ? "duel" : "party";
              const room = createRoom(hostId, roomMode, language, category, 15, false, true);

              // Register socket set for room
              roomSockets.set(room.code, new Set());

              // Add all players — carry userId + elo from their queue entry
              for (const entry of matched) {
                const entryPlayer: Player = {
                  id: entry.playerId,
                  name: entry.playerName,
                  score: 0,
                  eliminated: false,
                  userId: entry.userId,
                  elo: entry.elo,
                };
                addPlayerToRoom(room.code, entryPlayer);
                const extWs = entry.ws as ExtWebSocket;
                extWs.roomCode = room.code;
                extWs.playerId = entry.playerId;
                roomSockets.get(room.code)!.add(extWs);
              }

              // Notify remaining queue about updated count
              const remaining = getQueue(mode, language);
              for (const entry of remaining) {
                sendToSocket(entry.ws, { type: "queue_update", count: remaining.length, required: req });
              }

              // Auto-start game: shuffle turn order
              const turnOrder = matched.map((e) => e.playerId);
              for (let i = turnOrder.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [turnOrder[i], turnOrder[j]] = [turnOrder[j], turnOrder[i]];
              }
              const firstPlayerId = turnOrder[0];

              updateRoom(room.code, {
                status: "playing",
                subcategory,
                customSubcategory: false,
                acceptedAnswers: [],
                turnOrder,
                currentPlayerId: firstPlayerId,
                eliminationOrder: [],
              });

              const tsStart = Date.now();
              currentTurnStartedAt.set(room.code, tsStart);

              broadcastAll(room.code, {
                type: "match_found",
                room: getRoom(room.code),
                subcategory,
                firstPlayerId,
                turnStartedAt: tsStart,
              });

              if (firstPlayerId) scheduleTurnTimeout(room.code, firstPlayerId);
            }
          })();
          break;
        }

        case "leave_queue": {
          const { mode, language, playerId } = msg;
          leaveQueue(mode, language, playerId);
          // Cancel any pending bot-spawn timer for this player
          const bt = queueBotTimers.get(playerId);
          if (bt !== undefined) { clearTimeout(bt); queueBotTimers.delete(playerId); }
          const q = getQueue(mode, language);
          const req = getRequired(mode);
          for (const entry of q) {
            sendToSocket(entry.ws, { type: "queue_update", count: q.length, required: req });
          }
          break;
        }

        case "ping": break;

        default: break;
      }
    });

    ws.on("close", () => {
      // Remove from matchmaking queues if applicable
      if (ws.playerId && !ws.roomCode) {
        leaveAllQueues(ws.playerId);
        // Cancel any pending bot-spawn timer
        const bt = queueBotTimers.get(ws.playerId);
        if (bt !== undefined) { clearTimeout(bt); queueBotTimers.delete(ws.playerId); }
      }

      const roomCode = ws.roomCode;
      const playerId = ws.playerId;
      if (!roomCode || !playerId) return;

      const room = getRoom(roomCode);
      if (!room) return;

      if (room.status === "playing") {
        const key = `${roomCode}:${playerId}`;
        if (disconnectTimers.has(key)) return;
        const timer = setTimeout(() => {
          disconnectTimers.delete(key);
          const r = getRoom(roomCode);
          if (!r || r.status !== "playing") return;
          const p = r.players.find((pl) => pl.id === playerId);
          if (!p || p.eliminated) return;

          clearTurnTimer(roomCode);
          p.eliminated = true;
          r.eliminationOrder.push(playerId);
          updateRoom(roomCode, { players: r.players, eliminationOrder: r.eliminationOrder });

          if (!checkAndEndGame(roomCode)) {
            if (r.currentPlayerId === playerId) {
              const next = getNextPlayer(r);
              updateRoom(roomCode, { currentPlayerId: next });
              const ts = Date.now();
              currentTurnStartedAt.set(roomCode, ts);
              broadcastAll(roomCode, {
                type: "player_eliminated",
                playerId,
                nextPlayerId: next,
                turnStartedAt: ts,
                room: getRoom(roomCode),
              });
              if (next) scheduleTurnTimeout(roomCode, next);
              if (next && isBotId(next)) scheduleBotTurn(roomCode, next);
            } else {
              broadcastAll(roomCode, {
                type: "player_left",
                playerId,
                room: getRoom(roomCode),
              });
              if (r.currentPlayerId) scheduleTurnTimeout(roomCode, r.currentPlayerId);
              if (r.currentPlayerId && isBotId(r.currentPlayerId)) scheduleBotTurn(roomCode, r.currentPlayerId);
            }
          }
        }, 5_000);
        disconnectTimers.set(key, timer);
      } else {
        const sockets = roomSockets.get(roomCode);
        if (sockets) {
          sockets.delete(ws);
          if (room.status === "waiting") {
            removePlayerFromRoom(roomCode, playerId);
            const updated = getRoom(roomCode);
            if (updated && updated.players.length === 0) {
              clearLobbyInterval(roomCode);
              deleteRoom(roomCode);
            } else if (updated) {
              if (updated.hostId === playerId && updated.players.length > 0) {
                updateRoom(roomCode, { hostId: updated.players[0].id });
              }
              broadcastAll(roomCode, { type: "player_left", playerId, room: getRoom(roomCode) });
            }
          } else {
            broadcastAll(roomCode, { type: "player_left", playerId, room: getRoom(roomCode) });
          }
        }
      }
    });
  });

  return wss;
}
