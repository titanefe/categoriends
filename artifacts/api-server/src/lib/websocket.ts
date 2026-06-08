import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "http";
import type { Server } from "http";
import {
  createRoom,
  getRoom,
  updateRoom,
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
  | { type: "join"; roomCode: string; playerId: string; playerName: string }
  | { type: "start_game"; roomCode: string; subcategory: string }
  | { type: "answer_submitted"; roomCode: string; playerId: string; answer: string; valid: boolean; reason: string }
  | { type: "player_eliminated"; roomCode: string; playerId: string }
  | { type: "next_turn"; roomCode: string }
  | { type: "game_over_request"; roomCode: string; winnerId: string; winnerName: string }
  | { type: "reset_room"; roomCode: string }
  | { type: "update_room_settings"; roomCode: string; playerId: string; category: string; timeSeconds: number };

const roomSockets = new Map<string, Set<ExtWebSocket>>();

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

          const turnOrder = room.players.map((p) => p.id);
          const firstPlayerId = turnOrder[0] ?? null;

          updateRoom(msg.roomCode, {
            status: "playing",
            subcategory: msg.subcategory,
            acceptedAnswers: [],
            turnOrder,
            currentPlayerId: firstPlayerId,
          });

          broadcastAll(msg.roomCode, {
            type: "game_started",
            subcategory: msg.subcategory,
            firstPlayerId,
            room: getRoom(msg.roomCode),
          });
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
            const answers = [...room.acceptedAnswers, msg.answer];
            const player = room.players.find((p) => p.id === msg.playerId);
            if (player) player.score += 1;

            const nextPlayerId = getNextPlayer(room);
            updateRoom(msg.roomCode, {
              acceptedAnswers: answers,
              currentPlayerId: nextPlayerId,
              players: room.players,
            });

            broadcastAll(msg.roomCode, {
              type: "turn_passed",
              nextPlayerId,
              timeLeft: 10,
              room: getRoom(msg.roomCode),
            });
          }
          break;
        }

        case "player_eliminated": {
          const room = getRoom(msg.roomCode);
          if (!room || room.status !== "playing") return;

          const player = room.players.find((p) => p.id === msg.playerId);
          // Idempotent — ignore if already eliminated or not found
          if (!player || player.eliminated) return;

          player.eliminated = true;
          updateRoom(msg.roomCode, { players: room.players });

          if (checkAndEndGame(msg.roomCode)) break;

          const nextPlayerId = getNextPlayer(room);
          updateRoom(msg.roomCode, { currentPlayerId: nextPlayerId });

          broadcastAll(msg.roomCode, {
            type: "player_eliminated",
            playerId: msg.playerId,
            nextPlayerId,
            room: getRoom(msg.roomCode),
          });
          break;
        }

        case "next_turn": {
          const room = getRoom(msg.roomCode);
          if (!room) return;
          const nextPlayerId = getNextPlayer(room);
          updateRoom(msg.roomCode, { currentPlayerId: nextPlayerId });
          broadcastAll(msg.roomCode, {
            type: "turn_passed",
            nextPlayerId,
            timeLeft: 10,
            room: getRoom(msg.roomCode),
          });
          break;
        }

        case "game_over_request": {
          const room = getRoom(msg.roomCode);
          if (!room) return;
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
          const room = getRoom(msg.roomCode);
          if (!room) return;
          const resetPlayers = room.players.map((p) => ({
            ...p,
            score: 0,
            eliminated: false,
          }));
          updateRoom(msg.roomCode, {
            status: "waiting",
            acceptedAnswers: [],
            currentPlayerId: null,
            turnOrder: [],
            players: resetPlayers,
          });
          broadcastAll(msg.roomCode, {
            type: "room_reset",
            room: getRoom(msg.roomCode),
          });
          break;
        }

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
        // During an active game: mark the player as eliminated rather than
        // removing them — this prevents the active-player count from dropping
        // and causing a premature game-over for the remaining players.
        const player = room.players.find((p) => p.id === playerId);
        if (player && !player.eliminated) {
          player.eliminated = true;
          updateRoom(roomCode, { players: room.players });

          if (!checkAndEndGame(roomCode)) {
            // Game continues — if it was this player's turn, advance to next
            if (room.currentPlayerId === playerId) {
              const nextPlayerId = getNextPlayer(room);
              updateRoom(roomCode, { currentPlayerId: nextPlayerId });
              broadcastAll(roomCode, {
                type: "player_eliminated",
                playerId,
                nextPlayerId,
                room: getRoom(roomCode),
              });
            } else {
              broadcastAll(roomCode, {
                type: "player_left",
                playerId,
                room: getRoom(roomCode),
              });
            }
          }
        }
      } else {
        // Lobby or finished: remove the player normally
        removePlayerFromRoom(roomCode, playerId);
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
