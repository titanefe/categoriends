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
import { verifyAnswer as verifyAnswerAI } from "./verifyAnswer";

interface ExtWebSocket extends WebSocket {
  roomCode?: string;
  playerId?: string;
  /** userId resolved from the session cookie at connection time */
  sessionUserId?: string | null;
}

type WSMessage =
  | { type: "create_room"; hostId: string; playerName: string; mode: Room["mode"]; language: Room["language"]; category: string; timeSeconds?: number; impossibleMode?: boolean }
  | { type: "join"; roomCode: string; playerId: string; playerName: string; language?: string }
  | { type: "rejoin"; roomCode: string; playerId: string; rejoinSecret: string }
  | { type: "ping" }
  | { type: "start_game"; roomCode: string; subcategory: string; customSubcategory?: boolean }
  | { type: "answer_submitted"; roomCode: string; playerId: string; answer: string }
  | { type: "player_eliminated"; roomCode: string; playerId: string }
  | { type: "next_turn"; roomCode: string }
  | { type: "reset_room"; roomCode: string }
  | { type: "update_room_settings"; roomCode: string; playerId: string; category: string; timeSeconds: number; impossibleMode?: boolean }
  | { type: "kick_player"; roomCode: string; hostId: string; targetId: string }
  | { type: "leave_game"; roomCode: string; playerId: string }
  | { type: "leave_room"; roomCode: string; playerId: string };

const roomSockets = new Map<string, Set<ExtWebSocket>>();

const turnTimers = new Map<string, ReturnType<typeof setTimeout>>();
const disconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
const lobbyIntervals = new Map<string, ReturnType<typeof setInterval>>();
const currentTurnStartedAt = new Map<string, number>();

/**
 * Server-issued, per-seat rejoin secrets.
 * Key: `${roomCode}:${playerId}`. Value: UUID secret.
 * Generated at join/create, validated and rotated at rejoin.
 * Prevents anonymous seat hijacking via forged rejoin messages.
 */
const rejoinSecrets = new Map<string, string>();

function issueRejoinSecret(roomCode: string, playerId: string): string {
  const secret = randomUUID();
  rejoinSecrets.set(`${roomCode}:${playerId}`, secret);
  return secret;
}

function peekRejoinSecret(roomCode: string, playerId: string): string | undefined {
  return rejoinSecrets.get(`${roomCode}:${playerId}`);
}

function deleteRejoinSecret(roomCode: string, playerId: string): void {
  rejoinSecrets.delete(`${roomCode}:${playerId}`);
}

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

/**
 * Schedule the turn timeout for a player.
 * @param overrideDelayMs  If provided, uses this delay instead of the default (room.timeSeconds + 2) seconds.
 *                         Pass this when re-scheduling after a failed answer so the remaining time is preserved.
 */
function scheduleTurnTimeout(roomCode: string, playerId: string, overrideDelayMs?: number): void {
  const room = getRoom(roomCode);
  if (!room || room.status !== "playing") return;
  const delayMs = overrideDelayMs ?? (room.timeSeconds + 2) * 1000;
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
            [winnerId, duelEloDelta(winnerPlayer.elo, loserPlayer.elo, true, room.timeSeconds)],
            [loserId, duelEloDelta(loserPlayer.elo, winnerPlayer.elo, false, room.timeSeconds)],
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

            const hostSecret = issueRejoinSecret(room.code, msg.hostId);
            sendToSocket(ws, {
              type: "room_created",
              room: getRoom(room.code),
              rejoinSecret: hostSecret,
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
          // Reject if the claimed playerId is already present in the room.
          // This prevents an attacker from joining with the host's ID and passing
          // subsequent ws.playerId === room.hostId checks.
          if (room.players.some((p) => p.id === msg.playerId)) {
            sendToSocket(ws, { type: "error", message: "Player ID already taken" });
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

            const joinSecret = issueRejoinSecret(msg.roomCode, msg.playerId);
            sendToSocket(ws, {
              type: "room_state",
              room: getRoom(msg.roomCode),
              rejoinSecret: joinSecret,
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

          // Only the host socket may start the game.
          if (ws.playerId !== room.hostId) {
            logger.warn({ playerId: ws.playerId, hostId: room.hostId }, "WS: unauthorized start_game attempt");
            return;
          }

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
          if (!room || room.status !== "playing") return;

          // The sending socket must own the claimed playerId and be the current player.
          if (ws.playerId !== msg.playerId) {
            logger.warn({ wsPlayerId: ws.playerId, msgPlayerId: msg.playerId }, "WS: answer_submitted playerId mismatch");
            return;
          }
          if (room.currentPlayerId !== msg.playerId) {
            logger.warn({ currentPlayerId: room.currentPlayerId, msgPlayerId: msg.playerId }, "WS: answer_submitted not current player");
            return;
          }

          const player = room.players.find((p) => p.id === msg.playerId);
          if (!player || player.eliminated) return;

          // Capture the turn start timestamp before the async gap so we can
          // restore the remaining time if the answer is invalid.
          const turnStart = currentTurnStartedAt.get(msg.roomCode) ?? Date.now();

          // Pause the server-side timer while we wait for verification.
          clearTurnTimer(msg.roomCode);

          void (async () => {
            const result = await verifyAnswerAI(
              msg.answer,
              room.subcategory ?? "",
              room.acceptedAnswers,
              room.language,
            );

            // Re-fetch room state — it may have changed during the async gap.
            const currentRoom = getRoom(msg.roomCode);
            if (!currentRoom || currentRoom.status !== "playing") return;
            if (currentRoom.currentPlayerId !== msg.playerId) return;
            const currentPlayer = currentRoom.players.find((p) => p.id === msg.playerId);
            if (!currentPlayer || currentPlayer.eliminated) return;

            // Broadcast the authoritative result to all players.
            broadcastAll(msg.roomCode, {
              type: "answer_result",
              playerId: msg.playerId,
              answer: msg.answer,
              valid: result.valid,
              reason: result.reason,
            });

            if (result.valid) {
              const answers = [...currentRoom.acceptedAnswers, msg.answer];
              currentPlayer.score += 1;

              const nextPlayerId = getNextPlayer(currentRoom);
              const roomUpdates: Partial<Room> = {
                acceptedAnswers: answers,
                currentPlayerId: nextPlayerId,
                players: currentRoom.players,
              };
              if (currentRoom.impossibleMode) {
                roomUpdates.timeSeconds = Math.max(7, currentRoom.timeSeconds - 1);
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
            } else {
              // Invalid answer: reschedule the turn timer for the remaining time.
              const elapsed = Date.now() - turnStart;
              const totalMs = (currentRoom.timeSeconds + 2) * 1000;
              const remainingMs = Math.max(0, totalMs - elapsed);
              if (remainingMs <= 0) {
                // Time already expired during verification — eliminate the player.
                currentPlayer.eliminated = true;
                currentRoom.eliminationOrder.push(msg.playerId);
                updateRoom(msg.roomCode, { players: currentRoom.players, eliminationOrder: currentRoom.eliminationOrder });
                if (!checkAndEndGame(msg.roomCode)) {
                  const next = getNextPlayer(currentRoom);
                  updateRoom(msg.roomCode, { currentPlayerId: next });
                  const ts = Date.now();
                  currentTurnStartedAt.set(msg.roomCode, ts);
                  broadcastAll(msg.roomCode, {
                    type: "player_eliminated",
                    playerId: msg.playerId,
                    nextPlayerId: next,
                    turnStartedAt: ts,
                    room: getRoom(msg.roomCode),
                  });
                  if (next) scheduleTurnTimeout(msg.roomCode, next);
                }
              } else {
                scheduleTurnTimeout(msg.roomCode, msg.playerId, remainingMs);
              }
            }
          })();
          break;
        }

        case "player_eliminated": {
          const room = getRoom(msg.roomCode);
          if (!room || room.status !== "playing") return;

          // Only the player whose turn it is can report their own elimination,
          // and the sending socket must own that playerId.
          if (ws.playerId !== msg.playerId) {
            logger.warn({ wsPlayerId: ws.playerId, msgPlayerId: msg.playerId }, "WS: player_eliminated playerId mismatch");
            return;
          }
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
          if (!room || room.status !== "playing") return;

          // Only the current player's socket may advance the turn.
          if (ws.playerId !== room.currentPlayerId) {
            logger.warn({ wsPlayerId: ws.playerId, currentPlayerId: room.currentPlayerId }, "WS: unauthorized next_turn attempt");
            return;
          }

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

        case "reset_room": {
          const oldRoom = getRoom(msg.roomCode);
          if (!oldRoom) return;

          // Only the host socket may reset the room.
          if (ws.playerId !== oldRoom.hostId) {
            logger.warn({ wsPlayerId: ws.playerId, hostId: oldRoom.hostId }, "WS: unauthorized reset_room attempt");
            return;
          }

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
          // Clear all old per-seat secrets; the old roomCode is gone.
          for (const p of oldRoom.players) {
            deleteRejoinSecret(msg.roomCode, p.id);
          }
          deleteRoom(msg.roomCode);

          // Issue fresh rejoin secrets for all continuing sockets and distribute them.
          broadcastAll(newRoom.code, {
            type: "room_reset",
            room: getRoom(newRoom.code),
          });

          const newRoomSockets = roomSockets.get(newRoom.code);
          if (newRoomSockets) {
            for (const s of newRoomSockets) {
              if (s.playerId && s.readyState === WebSocket.OPEN) {
                const freshSecret = issueRejoinSecret(newRoom.code, s.playerId);
                sendToSocket(s, { type: "rejoin_secret", rejoinSecret: freshSecret });
              }
            }
          }

          startLobbyInterval(newRoom.code);
          break;
        }

        case "kick_player": {
          const room = getRoom(msg.roomCode);
          if (!room || room.status !== "waiting") return;

          // Verify the sending socket is actually the host.
          if (ws.playerId !== room.hostId) {
            logger.warn({ wsPlayerId: ws.playerId, hostId: room.hostId }, "WS: unauthorized kick_player attempt");
            return;
          }

          const sockets = roomSockets.get(msg.roomCode);
          if (sockets) {
            for (const s of sockets) {
              if (s.playerId === msg.targetId) {
                sendToSocket(s, { type: "player_kicked" });
                break;
              }
            }
          }
          deleteRejoinSecret(msg.roomCode, msg.targetId);
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
          // Only the socket that owns the playerId may leave on its behalf.
          if (ws.playerId !== msg.playerId) {
            logger.warn({ wsPlayerId: ws.playerId, msgPlayerId: msg.playerId }, "WS: leave_room playerId mismatch");
            return;
          }
          deleteRejoinSecret(msg.roomCode, msg.playerId);
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

          // Only the socket that owns the playerId may leave on its behalf.
          if (ws.playerId !== msg.playerId) {
            logger.warn({ wsPlayerId: ws.playerId, msgPlayerId: msg.playerId }, "WS: leave_game playerId mismatch");
            return;
          }

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
          const room = getRoom(msg.roomCode);
          if (!room) { sendToSocket(ws, { type: "error", message: "Room not found" }); return; }
          const rejoiningPlayer = room.players.find((p) => p.id === msg.playerId);
          if (!rejoiningPlayer) { sendToSocket(ws, { type: "error", message: "Player not found" }); return; }

          // For authenticated players, the seat's userId must match the session.
          // This prevents an attacker from claiming a disconnected authenticated
          // player's seat even when no active socket is present.
          if (rejoiningPlayer.userId) {
            if (!ws.sessionUserId || ws.sessionUserId !== rejoiningPlayer.userId) {
              logger.warn({ sessionUserId: ws.sessionUserId, playerUserId: rejoiningPlayer.userId }, "WS: rejoin session mismatch");
              sendToSocket(ws, { type: "error", message: "Session mismatch" });
              return;
            }
          }

          // Validate the server-issued rejoin secret WITHOUT deleting it first.
          // We only consume (delete) the stored secret after all checks pass.
          // Failing early keeps the stored secret intact so the legitimate player
          // can still reconnect after an attacker's failed attempt.
          const storedSecret = peekRejoinSecret(msg.roomCode, msg.playerId);
          if (!storedSecret || storedSecret !== msg.rejoinSecret) {
            logger.warn({ playerId: msg.playerId }, "WS: rejoin rejected — invalid secret");
            sendToSocket(ws, { type: "error", message: "Invalid rejoin secret" });
            return;
          }

          // Prevent seat-stealing: reject if another active socket already owns this seat.
          // Do NOT modify the stored secret here — the legitimate socket may need it later.
          const existingSockets = roomSockets.get(msg.roomCode);
          if (existingSockets) {
            for (const s of existingSockets) {
              if (s !== ws && s.playerId === msg.playerId && s.readyState === WebSocket.OPEN) {
                logger.warn({ playerId: msg.playerId }, "WS: rejoin rejected — seat already active");
                sendToSocket(ws, { type: "error", message: "Seat already active" });
                return;
              }
            }
          }

          // All checks passed — now consume the old secret and issue a fresh one.
          deleteRejoinSecret(msg.roomCode, msg.playerId);
          clearDisconnectTimer(msg.roomCode, msg.playerId);
          ws.roomCode = msg.roomCode;
          ws.playerId = msg.playerId;
          if (!roomSockets.has(msg.roomCode)) roomSockets.set(msg.roomCode, new Set());
          roomSockets.get(msg.roomCode)!.add(ws);

          // Issue a fresh secret so the old one cannot be replayed.
          const newSecret = issueRejoinSecret(msg.roomCode, msg.playerId);
          const tsSynced = currentTurnStartedAt.get(msg.roomCode) ?? Date.now();
          sendToSocket(ws, {
            type: "game_state_sync",
            room: getRoom(msg.roomCode),
            turnStartedAt: tsSynced,
            rejoinSecret: newSecret,
          });
          break;
        }

        case "update_room_settings": {
          const room = getRoom(msg.roomCode);
          if (!room || room.status !== "waiting") return;

          // Verify the sending socket is actually the host.
          if (ws.playerId !== room.hostId) {
            logger.warn({ wsPlayerId: ws.playerId, hostId: room.hostId }, "WS: unauthorized update_room_settings attempt");
            return;
          }

          updateRoom(msg.roomCode, { category: msg.category, timeSeconds: msg.timeSeconds, impossibleMode: msg.impossibleMode ?? false });
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
          // Player is permanently eliminated — they won't rejoin.
          deleteRejoinSecret(roomCode, playerId);
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
            deleteRejoinSecret(roomCode, playerId);
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
