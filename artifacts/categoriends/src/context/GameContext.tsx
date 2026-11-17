import { createContext, useContext, useState, useRef, useEffect, ReactNode } from "react";
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
  customSubcategory?: boolean;
  language: Language;
  timeSeconds: number;
  impossibleMode?: boolean;
  quickMatch?: boolean;
  turnOrder: string[];
}

export interface GameState {
  subcategory: string;
  currentPlayerId: string;
  acceptedAnswers: string[];
  timeLeft: number;
  round: number;
  turnStartedAt: number;
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
  eloDeltas: Record<string, number> | null;
  setEloDeltas: (d: Record<string, number> | null) => void;
  soloToken: string | null;
  setSoloToken: (t: string | null) => void;
  isDailyMode: boolean;
  setIsDailyMode: (v: boolean) => void;
  ws: WebSocket | null;
  connectWs: () => WebSocket;
  disconnectWs: () => void;
}

const GameContext = createContext<GameContextType | null>(null);

export function GameProvider({ children }: { children: ReactNode }) {
  const [player, setPlayerState] = useState<Player | null>(null);
  const [room, setRoomState] = useState<Room | null>(null);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [eloDeltas, setEloDeltas] = useState<Record<string, number> | null>(null);
  const [soloToken, setSoloToken] = useState<string | null>(null);
  const [isDailyMode, setIsDailyMode] = useState(false);
  const [wsInstance, setWsInstance] = useState<WebSocket | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const roomRef = useRef<Room | null>(null);
  const playerRef = useRef<Player | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const preventReconnectRef = useRef(false);

  const setRoom = (r: Room | null) => {
    roomRef.current = r;
    setRoomState(r);
  };

  const setPlayer = (p: Player | null) => {
    playerRef.current = p;
    setPlayerState(p);
  };

  function stopPing() {
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = null;
    }
  }

  function startPing(ws: WebSocket) {
    stopPing();
    pingIntervalRef.current = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        try { ws.send(JSON.stringify({ type: "ping" })); } catch {}
      }
    }, 20_000);
  }

  function openConnection(onOpen?: (ws: WebSocket) => void): WebSocket {
    // In production the game server lives on its own subdomain
    // (VITE_WS_URL, e.g. wss://api.categoriends.com/ws); locally it's same-host.
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl =
      (import.meta.env.VITE_WS_URL as string | undefined) ||
      `${protocol}//${window.location.host}/ws`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setWsInstance(ws);
      startPing(ws);
      onOpen?.(ws);
    };

    ws.onclose = () => {
      stopPing();
      if (wsRef.current === ws) {
        wsRef.current = null;
        setWsInstance(null);
      }
      if (preventReconnectRef.current) return;
      const r = roomRef.current;
      const p = playerRef.current;
      if (r && p && r.status === "playing") {
        scheduleReconnect();
      }
    };

    ws.onerror = () => { /* onclose fires after onerror */ };

    return ws;
  }

  function scheduleReconnect() {
    if (reconnectTimerRef.current) return;
    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null;
      if (preventReconnectRef.current) return;
      const r = roomRef.current;
      const p = playerRef.current;
      if (!r || !p || r.status !== "playing") return;
      if (wsRef.current && wsRef.current.readyState !== WebSocket.CLOSED) return;

      openConnection((ws) => {
        const r2 = roomRef.current;
        const p2 = playerRef.current;
        if (r2 && p2) {
          try {
            ws.send(JSON.stringify({ type: "rejoin", roomCode: r2.code, playerId: p2.id }));
          } catch {}
        }
      });
    }, 1_500);
  }

  useEffect(() => {
    const handleVisibility = () => {
      if (document.hidden || preventReconnectRef.current) return;
      const r = roomRef.current;
      const p = playerRef.current;
      if (!r || !p || r.status !== "playing") return;
      const ws = wsRef.current;
      if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
        if (reconnectTimerRef.current) {
          clearTimeout(reconnectTimerRef.current);
          reconnectTimerRef.current = null;
        }
        scheduleReconnect();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  const connectWs = (): WebSocket => {
    if (wsRef.current && wsRef.current.readyState !== WebSocket.CLOSED) {
      return wsRef.current;
    }
    return openConnection();
  };

  const disconnectWs = () => {
    preventReconnectRef.current = true;
    stopPing();
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
      setWsInstance(null);
    }
    setTimeout(() => { preventReconnectRef.current = false; }, 300);
  };

  return (
    <GameContext.Provider value={{
      player, setPlayer,
      room, setRoom,
      gameState, setGameState,
      eloDeltas, setEloDeltas,
      soloToken, setSoloToken,
      isDailyMode, setIsDailyMode,
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
