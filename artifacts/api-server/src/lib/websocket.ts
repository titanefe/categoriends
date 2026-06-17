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
import { duelEloDelta, partyEloDeltas } from "./elo";
import { logger } from "./logger";
import { sessionMiddleware } from "../app";

interface ExtWebSocket extends WebSocket {
  roomCode?: string;
  playerId?: string;
  /** userId resolved from the session cookie at connection time */
  sessionUserId?: string | null;
}

type WSMessage =
  | { type: "create_room"; hostId: string; playerName: string; mode: Room["mode"]; language: Room["language"]; category: string; timeSeconds?: number }
  | { type: "join"; roomCode: string; playerId: string; playerName: string; language?: string }
  | { type: "rejoin"; roomCode: string; playerId: string }
  | { type: "ping" }
  | { type: "start_game"; roomCode: string; subcategory: string; customSubcategory?: boolean }
  | { type: "answer_submitted"; roomCode: string; playerId: string; answer: string; valid: boolean; reason: string }
  | { type: "player_eliminated"; roomCode: string; playerId: string }
  | { type: "next_turn"; roomCode: string }
  | { type: "game_over_request"; roomCode: string; winnerId: string; winnerName: string }
  | { type: "reset_room"; roomCode: string }
  | { type: "update_room_settings"; roomCode: string; playerId: string; category: string; timeSeconds: number }
  | { type: "kick_player"; roomCode: string; hostId: string; targetId: string }
  | { type: "leave_game"; roomCode: string; playerId: string }
  | { type: "leave_room"; roomCode: string; playerId: string };

const roomSockets = new Map<string, Set<ExtWebSocket>>();

const turnTimers = new Map<string, ReturnType<typeof setTimeout>>();
const disconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
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

      let deltaMap: Map<string, number>;
      if (room.mode === "duel" && room.players.length === 2) {
        const winnerId = rankOrder[0];
        const loserId = rankOrder[1];
        const winnerPlayer = room.players.find((p) => p.id === winnerId);
        const loserPlayer = room.players.find((p) => p.id === loserId);
        if (winnerPlayer && loserPlayer) {
          deltaMap = new Map([
            [winnerId, duelEloDelta(winnerPlayer.elo, loserPlayer.elo, true)],
            [loserId, duelEloDelta(loserPlayer.elo, winnerPlayer.elo, false)],
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
  const wss = new WebSocketServer({ server, path: "/ws" });

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

            const room = createRoom(msg.hostId, msg.mode, msg.language, msg.category, msg.timeSeconds ?? 15);
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
            updateRoom(msg.roomCode, {
              acceptedAnswers: answers,
              currentPlayerId: nextPlayerId,
              players: room.players,
            });

            const tsTurnPassed = Date.now();
            currentTurnStartedAt.set(msg.roomCode, tsTurnPassed);
            broadcastAll(msg.roomCode, {
              type: "turn_passed",
              nextPlayerId,
              turnStartedAt: tsTurnPassed,
              room: getRoom(msg.roomCode),
            });
            if (nextPlayerId) scheduleTurnTimeout(msg.roomCode, nextPlayerId);
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

          const newRoom = createRoom(
            newHostId,
            oldRoom.mode,
            oldRoom.language,
            oldRoom.category,
            oldRoom.timeSeconds,
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
            } else {
              broadcastAll(msg.roomCode, {
                type: "player_eliminated",
                playerId: msg.playerId,
                nextPlayerId: room.currentPlayerId,
                turnStartedAt: tsLeave,
                room: getRoom(msg.roomCode),
              });
              if (room.currentPlayerId) scheduleTurnTimeout(msg.roomCode, room.currentPlayerId);
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
          updateRoom(msg.roomCode, { category: msg.category, timeSeconds: msg.timeSeconds });
          broadcastAll(msg.roomCode, {
            type: "lobby_sync",
            room: getRoom(msg.roomCode),
          });
          break;
        }

        case "ping": break;

        default: break;
      }
    });

    ws.on("close", () => {
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
            } else {
              broadcastAll(roomCode, {
                type: "player_left",
                playerId,
                room: getRoom(roomCode),
              });
              if (r.currentPlayerId) scheduleTurnTimeout(roomCode, r.currentPlayerId);
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
