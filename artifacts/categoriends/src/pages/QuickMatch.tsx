import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useTranslation } from "@/i18n/translations";
import { useGame } from "@/context/GameContext";
import { useAuth } from "@/context/AuthContext";

type QueueMode = "duel" | "party4";

export default function QuickMatch() {
  const { t, lang } = useTranslation();
  const { connectWs, ws, setRoom, setPlayer, setGameState, disconnectWs } = useGame();
  const { user } = useAuth();
  const [, setLocation] = useLocation();

  const [phase, setPhase] = useState<"pick" | "waiting">("pick");
  const [queueMode, setQueueMode] = useState<QueueMode | null>(null);
  const [count, setCount] = useState(0);
  const [required, setRequired] = useState(2);
  const [matchFound, setMatchFound] = useState(false);

  const playerId = useRef(`qm-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const playerName = user?.username ?? t("game.soloPlayerName");
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    return () => {
      // If leaving page without cancelling, clean up queue
      if (wsRef.current && queueMode && !matchFound) {
        try {
          wsRef.current.send(JSON.stringify({
            type: "leave_queue",
            mode: queueMode,
            language: lang,
            playerId: playerId.current,
          }));
        } catch {}
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queueMode, matchFound]);

  useEffect(() => {
    if (!ws) return;
    wsRef.current = ws;

    const handleMsg = (evt: MessageEvent) => {
      try {
        const data = JSON.parse(evt.data);

        if (data.type === "queue_update") {
          setCount(data.count as number);
          setRequired(data.required as number);
        }

        if (data.type === "match_found" && data.room) {
          setMatchFound(true);
          const room = data.room;
          const me = room.players.find((p: { id: string }) => p.id === playerId.current);
          setRoom(room);
          setPlayer(me ?? { id: playerId.current, name: playerName, score: 0, eliminated: false });
          setGameState({
            subcategory: data.subcategory,
            currentPlayerId: data.firstPlayerId,
            acceptedAnswers: [],
            timeLeft: room.timeSeconds ?? 15,
            round: 1,
            turnStartedAt: data.turnStartedAt ?? Date.now(),
          });
          setLocation("/game");
        }
      } catch {}
    };

    ws.addEventListener("message", handleMsg);
    return () => ws.removeEventListener("message", handleMsg);
  }, [ws, setRoom, setPlayer, setGameState, setLocation, playerName]);

  function handleSelectMode(mode: QueueMode) {
    setQueueMode(mode);
    setRequired(mode === "duel" ? 2 : 4);
    setCount(0);
    setPhase("waiting");

    const socket = connectWs();
    wsRef.current = socket;

    const send = () => {
      socket.send(JSON.stringify({
        type: "join_queue",
        mode,
        language: lang,
        playerId: playerId.current,
        playerName,
      }));
    };

    if (socket.readyState === WebSocket.OPEN) {
      send();
    } else {
      socket.addEventListener("open", send, { once: true });
    }
  }

  function handleCancel() {
    if (wsRef.current && queueMode) {
      try {
        wsRef.current.send(JSON.stringify({
          type: "leave_queue",
          mode: queueMode,
          language: lang,
          playerId: playerId.current,
        }));
      } catch {}
    }
    setPhase("pick");
    setQueueMode(null);
    setCount(0);
  }

  function handleBack() {
    handleCancel();
    disconnectWs();
    setLocation("/");
  }

  if (phase === "waiting") {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4">
        <div className="w-full max-w-sm text-center">
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-80 h-80 rounded-full bg-primary/10 blur-3xl" />
          </div>

          <div className="relative z-10">
            {/* Animated indicator */}
            <div className="flex items-center justify-center mb-8">
              <div className="relative w-24 h-24">
                <div className="absolute inset-0 rounded-full border-2 border-primary/20" />
                <div className="absolute inset-0 rounded-full border-2 border-t-primary animate-spin" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-2xl font-bold font-mono text-primary">
                    {count}/{required}
                  </span>
                </div>
              </div>
            </div>

            <h2 className="text-2xl font-bold text-foreground mb-2">
              {t("quickmatch.searching")}
            </h2>
            <p className="text-muted-foreground text-sm font-mono mb-2">
              {queueMode === "duel" ? t("quickmatch.mode1v1") : t("quickmatch.mode4p")}
            </p>
            <p className="text-muted-foreground/60 text-xs font-mono mb-10">
              {t("quickmatch.playersWaiting").replace("{n}", String(count)).replace("{total}", String(required))}
            </p>

            {/* Player dots */}
            <div className="flex items-center justify-center gap-3 mb-10">
              {Array.from({ length: required }).map((_, i) => (
                <div
                  key={i}
                  className={`w-3 h-3 rounded-full transition-all duration-300 ${
                    i < count
                      ? "bg-primary shadow-[0_0_8px_var(--primary)]"
                      : "bg-muted-foreground/20"
                  }`}
                />
              ))}
            </div>

            <button
              onClick={handleCancel}
              className="w-full py-4 rounded-xl font-semibold text-lg border border-border text-muted-foreground hover:border-destructive/50 hover:text-destructive active:scale-[0.98] transition-all"
            >
              {t("quickmatch.cancel")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <button
          onClick={handleBack}
          className="text-muted-foreground hover:text-foreground transition-colors text-sm mb-8 flex items-center gap-1"
        >
          &larr; {t("nav.back")}
        </button>

        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/15 border border-primary/30 mb-3">
            <svg className="w-7 h-7 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-foreground mb-1">{t("quickmatch.title")}</h1>
          <p className="text-muted-foreground text-sm">{t("quickmatch.subtitle")}</p>
        </div>

        <div className="flex flex-col gap-4">
          <button
            onClick={() => handleSelectMode("duel")}
            className="w-full py-5 rounded-xl font-semibold text-lg bg-primary text-primary-foreground hover:opacity-90 active:scale-[0.98] transition-all animate-glow-primary flex flex-col items-center gap-1"
          >
            <span className="text-xl">{t("quickmatch.mode1v1")}</span>
            <span className="text-sm font-normal opacity-80">{t("quickmatch.desc1v1")}</span>
          </button>

          <button
            onClick={() => handleSelectMode("party4")}
            className="w-full py-5 rounded-xl font-semibold text-lg border border-primary/40 text-primary hover:bg-primary/10 hover:border-primary active:scale-[0.98] transition-all flex flex-col items-center gap-1"
          >
            <span className="text-xl">{t("quickmatch.mode4p")}</span>
            <span className="text-sm font-normal opacity-80">{t("quickmatch.desc4p")}</span>
          </button>
        </div>

        <p className="text-center text-xs text-muted-foreground/50 font-mono mt-6">
          {t("quickmatch.playingAs").replace("{name}", playerName)}
        </p>
      </div>
    </div>
  );
}
