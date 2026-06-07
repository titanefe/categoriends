import { createContext, useContext, useEffect, useState, useRef, ReactNode } from "react";
import { Language } from "../i18n/translations";

export type GameMode = "solo" | "duel" | "party";

export interface Player {
  id: string;
  name: string;
  score: number;
  eliminated: boolean;
}

export interface Room {
  code: string;
  mode: GameMode;
  hostId: string;
  players: Player[];
  status: "waiting" | "playing" | "finished";
  subcategory: string;
  category: string;
  language: Language;
}

export interface GameState {
  subcategory: string;
  currentPlayerId: string;
  acceptedAnswers: string[];
  timeLeft: number;
  round: number;
}

export interface AnswerResult {
  valid: boolean;
  reason: string;
}

interface GameContextType {
  player: Player | null;
  setPlayer: (p: Player | null) => void;
  room: Room | null;
  setRoom: (r: Room | null) => void;
  gameState: GameState | null;
  setGameState: (gs: GameState | null) => void;
  ws: WebSocket | null;
  connectWs: () => void;
  disconnectWs: () => void;
}

const GameContext = createContext<GameContextType | null>(null);

export function GameProvider({ children }: { children: ReactNode }) {
  const [player, setPlayer] = useState<Player | null>(null);
  const [room, setRoom] = useState<Room | null>(null);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const connectWs = () => {
    if (wsRef.current) return;
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    const ws = new WebSocket(wsUrl);

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log("WS message:", data);
        if (data.type === "room_state" && data.room) {
          setRoom(data.room);
        }
        if (data.type === "game_started") {
          setGameState({
            subcategory: data.subcategory,
            currentPlayerId: data.firstPlayerId,
            acceptedAnswers: [],
            timeLeft: 10,
            round: 1
          });
        }
        if (data.type === "turn_passed") {
          setGameState(prev => prev ? { ...prev, currentPlayerId: data.nextPlayerId, timeLeft: data.timeLeft } : null);
        }
        if (data.type === "answer_result") {
          if (data.valid) {
            setGameState(prev => prev ? { ...prev, acceptedAnswers: [...prev.acceptedAnswers, data.answer] } : null);
          }
        }
      } catch (e) {
        console.error("Failed to parse ws message", e);
      }
    };

    wsRef.current = ws;
  };

  const disconnectWs = () => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  };

  return (
    <GameContext.Provider value={{
      player, setPlayer,
      room, setRoom,
      gameState, setGameState,
      ws: wsRef.current,
      connectWs, disconnectWs
    }}>
      {children}
    </GameContext.Provider>
  );
}

export function useGame() {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error("useGame must be used within GameProvider");
  return ctx;
}
