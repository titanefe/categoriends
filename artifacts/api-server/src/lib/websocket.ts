import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "http";
import type { Server } from "http";
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
import { logger } from "./logger";

interface ExtWebSocket extends WebSocket {
  roomCode?: string;
  playerId?: string;
}

type WSMessage =
  | { type: "create_room"; hostId: string; playerName: string; mode: Room["mode"]; language: Room["language"]; category: string; timeSeconds?: number }
  | { type: "join"; roomCode: string; playerId: string; playerName: string; language?: string }
  | { type: "rejoin"; roomCode: string; playerId: string }
  | { type: "ping" }
  | { type: "start_game"; roomCode: string; subcategory: string }
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

// Server-side per-room turn timers — auto-eliminates a ghost player if the
// client never sends player_eliminated within the allowed turn window.
const turnTimers = new Map<string, ReturnType<typeof setTimeout>>();

// Disconnect grace-period timers: give players 5 s to reconnect before eliminating.
const disconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();

// Tracks when the current turn started (per room) so rejoining clients can resync their timer.
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

function scheduleTurnTimeout(roomCode: string, playerId: string): void {
  const room = getRoom(roomCode);
  if (!room || room.status !== "playing") return;
  const delayMs = (room.timeSeconds + 2) * 1000;
  clearTurnTimer(roomCode);
  const timer = setTimeout(() => {
    turnTimers.delete(roomCode);
    const r = getRoom(roomCode);
    if (!r || r.status !== "playing") return;
    if (r.currentPlayerId !== playerId) return; // turn already moved on
    const p = r.players.find((pl) => pl.id === playerId);
    if (!p || p.eliminated) return;
    // Auto-eliminate the unresponsive player
    p.eliminated = true;
    updateRoom(roomCode, { players: r.players });
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

function checkAndEndGame(roomCode: string): boolean {
  const room = getRoom(roomCode);
  if (!room || room.status !== "playing") return false;
  const activePlayers = room.players.filter((p) => !p.eliminated);
  if (activePlayers.length <= 1) {
    const winner = activePlayers[0] ?? null;
    updateRoom(roomCode, { status: "finished" });
    const scores = room.players.map((p) => ({ id: p.id, name: p.name, score: p.score }));
    broadcastAll(roomCode, {
      type: "game_over",
      winnerId: winner?.id ?? null,
      winnerName: winner?.name ?? "Nobody",
      scores,
    });
    return true;
  }
  return false;
}

export function setupWebSocket(server: Server): WebSocketServer {
  const wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (ws: ExtWebSocket, req: IncomingMessage) => {
    logger.info({ ip: req.socket.remoteAddress }, "WS client connected");

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
          const room = createRoom(msg.hostId, msg.mode, msg.language, msg.category, msg.timeSeconds ?? 15);
          const player: Player = {
            id: msg.hostId,
            name: msg.playerName,
            score: 0,
            eliminated: false,
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

          const player: Player = {
            id: msg.playerId,
            name: msg.playerName,
            score: 0,
            eliminated: false,
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
            type: "player_joined",
            player,
            room: getRoom(msg.roomCode),
          });
          break;
        }

        case "start_game": {
          const room = getRoom(msg.roomCode);
          if (!room) return;

          // Shuffle player order so the first player is random
          const turnOrder = [...room.players.map((p) => p.id)];
          for (let i = turnOrder.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [turnOrder[i], turnOrder[j]] = [turnOrder[j], turnOrder[i]];
          }
          const firstPlayerId = turnOrder[0] ?? null;

          updateRoom(msg.roomCode, {
            status: "playing",
            subcategory: msg.subcategory,
            acceptedAnswers: [],
            turnOrder,
            currentPlayerId: firstPlayerId,
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

          const player = room.players.find((p) => p.id === msg.playerId);
          // Idempotent — ignore if already eliminated or not found
          if (!player || player.eliminated) return;

          clearTurnTimer(msg.roomCode);
          player.eliminated = true;
          updateRoom(msg.roomCode, { players: room.players });

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
          const room = getRoom(msg.roomCode);
          if (!room) return;
          clearTurnTimer(msg.roomCode);
          updateRoom(msg.roomCode, { status: "finished" });
          const scores = room.players.map((p) => ({ id: p.id, name: p.name, score: p.score }));
          broadcastAll(msg.roomCode, {
            type: "game_over",
            winnerId: msg.winnerId,
            winnerName: msg.winnerName,
            scores,
          });
          break;
        }

        case "reset_room": {
          const oldRoom = getRoom(msg.roomCode);
          if (!oldRoom) return;

          clearTurnTimer(msg.roomCode);

          // Create a brand-new room so everything is clean (fixes custom-category
          // sticking around and 2nd-game crashes from stale state)
          const newRoom = createRoom(
            oldRoom.hostId,
            oldRoom.mode,
            oldRoom.language,
            oldRoom.category,
            oldRoom.timeSeconds,
          );
          for (const p of oldRoom.players) {
            addPlayerToRoom(newRoom.code, { ...p, score: 0, eliminated: false });
          }

          // Move all socket references from the old room to the new one
          const oldSockets = roomSockets.get(msg.roomCode);
          if (oldSockets) {
            roomSockets.set(newRoom.code, new Set(oldSockets));
            roomSockets.delete(msg.roomCode);
            for (const s of oldSockets) {
              s.roomCode = newRoom.code;
            }
          }

          deleteRoom(msg.roomCode);

          broadcastAll(newRoom.code, {
            type: "room_reset",
            room: getRoom(newRoom.code),
          });
          break;
        }

        case "kick_player": {
          const room = getRoom(msg.roomCode);
          if (!room || room.hostId !== msg.hostId || room.status !== "waiting") return;
          // Notify the kicked player before removing them
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
          broadcastAll(msg.roomCode, {
            type: "player_left",
            playerId: msg.targetId,
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
          broadcastAll(msg.roomCode, {
            type: "player_left",
            playerId: msg.playerId,
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
          updateRoom(msg.roomCode, { players: room.players });

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
          // Re-attach this socket to the room
          ws.roomCode = msg.roomCode;
          ws.playerId = msg.playerId;
          if (!roomSockets.has(msg.roomCode)) roomSockets.set(msg.roomCode, new Set());
          roomSockets.get(msg.roomCode)!.add(ws);
          // Send full game state so the rejoining client resyncs their timer and UI
          const tsSynced = currentTurnStartedAt.get(msg.roomCode) ?? Date.now();
          sendToSocket(ws, {
            type: "game_state_sync",
            room: getRoom(msg.roomCode),
            turnStartedAt: tsSynced,
          });
          break;
        }

        case "ping":
          break;

        case "update_room_settings": {
          const room = getRoom(msg.roomCode);
          if (!room) return;
          if (room.hostId !== msg.playerId) return;
          if (room.status !== "waiting") return;
          updateRoom(msg.roomCode, {
            category: msg.category,
            timeSeconds: msg.timeSeconds,
          });
          broadcastAll(msg.roomCode, {
            type: "room_settings_updated",
            room: getRoom(msg.roomCode),
          });
          break;
        }
      }
    });

    ws.on("close", () => {
      const { roomCode, playerId } = ws;
      if (!roomCode || !playerId) return;

      const sockets = roomSockets.get(roomCode);
      if (sockets) {
        sockets.delete(ws);
        if (sockets.size === 0) roomSockets.delete(roomCode);
      }

      const room = getRoom(roomCode);
      if (!room) {
        logger.info({ roomCode, playerId }, "WS client disconnected (no room)");
        return;
      }

      if (room.status === "playing") {
        // During an active game: give the player a 5-second grace period to
        // reconnect (tab switch, brief network blip) before eliminating them.
        const player = room.players.find((p) => p.id === playerId);
        if (player && !player.eliminated) {
          const graceKey = `${roomCode}:${playerId}`;
          clearDisconnectTimer(roomCode, playerId);
          disconnectTimers.set(graceKey, setTimeout(() => {
            disconnectTimers.delete(graceKey);
            const r = getRoom(roomCode);
            if (!r || r.status !== "playing") return;
            const p = r.players.find((pl) => pl.id === playerId);
            if (!p || p.eliminated) return; // already handled elsewhere

            clearTurnTimer(roomCode);
            p.eliminated = true;
            updateRoom(roomCode, { players: r.players });

            if (!checkAndEndGame(roomCode)) {
              const ts = Date.now();
              currentTurnStartedAt.set(roomCode, ts);
              if (r.currentPlayerId === playerId) {
                const nextPlayerId = getNextPlayer(r);
                updateRoom(roomCode, { currentPlayerId: nextPlayerId });
                broadcastAll(roomCode, {
                  type: "player_eliminated",
                  playerId,
                  nextPlayerId,
                  turnStartedAt: ts,
                  room: getRoom(roomCode),
                });
                if (nextPlayerId) scheduleTurnTimeout(roomCode, nextPlayerId);
              } else {
                broadcastAll(roomCode, {
                  type: "player_eliminated",
                  playerId,
                  nextPlayerId: r.currentPlayerId,
                  turnStartedAt: ts,
                  room: getRoom(roomCode),
                });
                if (r.currentPlayerId) scheduleTurnTimeout(roomCode, r.currentPlayerId);
              }
            }
          }, 5_000));
        }
      } else {
        // Lobby or finished: remove the player normally
        const wasHost = room.hostId === playerId;
        removePlayerFromRoom(roomCode, playerId);

        // Promote the next player if the host left
        if (wasHost) {
          const remaining = getRoom(roomCode)?.players ?? [];
          if (remaining.length > 0) {
            updateRoom(roomCode, { hostId: remaining[0].id });
          }
        }

        broadcastAll(roomCode, {
          type: "player_left",
          playerId,
          room: getRoom(roomCode),
        });
      }

      logger.info({ roomCode, playerId }, "WS client disconnected");
    });

    ws.on("error", (err) => {
      logger.error({ err }, "WS error");
    });
  });

  return wss;
}
