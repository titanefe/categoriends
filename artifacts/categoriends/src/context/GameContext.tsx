import { createContext, useContext, useState, useRef, ReactNode } from "react";
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
  timeSeconds: number;
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
  connectWs: () => WebSocket;
  disconnectWs: () => void;
}

const GameContext = createContext<GameContextType | null>(null);

export function GameProvider({ children }: { children: ReactNode }) {
  const [player, setPlayer] = useState<Player | null>(null);
  const [room, setRoom] = useState<Room | null>(null);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [wsInstance, setWsInstance] = useState<WebSocket | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const connectWs = (): WebSocket => {
    if (wsRef.current && wsRef.current.readyState !== WebSocket.CLOSED) {
      return wsRef.current;
    }
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      setWsInstance(ws);
    };

    ws.onclose = () => {
      wsRef.current = null;
      setWsInstance(null);
    };

    ws.onerror = () => {
      wsRef.current = null;
      setWsInstance(null);
    };

    wsRef.current = ws;
    return ws;
  };

  const disconnectWs = () => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
      setWsInstance(null);
    }
  };

  return (
    <GameContext.Provider value={{
      player, setPlayer,
      room, setRoom,
      gameState, setGameState,
      ws: wsInstance,
      connectWs, disconnectWs,
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
