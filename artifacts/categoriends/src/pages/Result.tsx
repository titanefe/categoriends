import { useEffect } from "react";
import { useLocation } from "wouter";
import { useTranslation } from "@/i18n/translations";
import { useGame } from "@/context/GameContext";

export default function Result() {
  const { t } = useTranslation();
  const { room, gameState, player, setRoom, setGameState, disconnectWs, ws } = useGame();
  const [, setLocation] = useLocation();

  const isSolo = room?.mode === "solo";
  const score = isSolo ? (gameState?.acceptedAnswers.length ?? 0) : 0;
  const subcategory = gameState?.subcategory ?? "";

  const allPlayers = room?.players ?? [];
  const sorted = [...allPlayers].sort((a, b) => b.score - a.score);
  const winner = isSolo ? player : sorted[0];
  const isHost = player?.id === room?.hostId;

  // Listen for room_reset and player_left (multiplayer)
  useEffect(() => {
    if (!ws || isSolo) return;
    const handleMsg = (evt: MessageEvent) => {
      try {
        const data = JSON.parse(evt.data);
        if (data.type === "room_reset" && data.room) {
          setRoom(data.room);
          setGameState(null);
          setLocation(`/room/${data.room.code}`);
        }
        // Keep room in sync so host promotion is reflected immediately
        if (data.type === "player_left" && data.room) {
          setRoom(data.room);
        }
      } catch {}
    };
    ws.addEventListener("message", handleMsg);
    return () => ws.removeEventListener("message", handleMsg);
  }, [ws, isSolo, setRoom, setGameState, setLocation]);

  function handlePlayAgain() {
    disconnectWs();
    setRoom(null);
    setGameState(null);
    setLocation("/");
  }

  function handleReturnToLobby() {
    if (!ws || !room) return;
    ws.send(JSON.stringify({ type: "reset_room", roomCode: room.code }));
    // Navigate immediately — don't wait for the broadcast round-trip.
    // RoomLobby's room_reset listener will redirect to the new code once the
    // server responds.
    setGameState(null);
    setLocation(`/room/${room.code}`);
  }

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm text-center">
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-80 h-80 rounded-full bg-primary/15 blur-3xl" />
        </div>

        <div className="relative z-10">
          <h1 data-testid="title-result" className="text-3xl font-bold mb-2 text-foreground">
            {t("result.title")}
          </h1>

          {winner && (
            <div className="my-8">
              <p className="text-xs text-muted-foreground font-mono tracking-widest uppercase mb-3">
                {t("result.winner")}
              </p>
              <p
                data-testid="text-winner"
                className="text-4xl font-bold text-primary neon-text mb-2"
                style={{ fontFamily: "'Space Mono', monospace" }}
              >
                {winner.name}
              </p>
              {isSolo && (
                <>
                  <div className="flex items-center justify-center gap-2 mt-4">
                    <span className="text-muted-foreground text-sm">{t("result.score")}</span>
                    <span data-testid="text-final-score" className="text-5xl font-bold font-mono text-accent neon-cyan">
                      {score}
                    </span>
                  </div>
                  {subcategory && (
                    <p className="text-muted-foreground text-xs font-mono mt-3">
                      <span className="text-muted-foreground/60">{t("result.subcategory")}</span>{" "}
                      <span className="text-foreground/80">{subcategory}</span>
                    </p>
                  )}
                </>
              )}
            </div>
          )}

          {/* Multiplayer scores */}
          {!isSolo && sorted.length > 0 && (
            <div className="bg-card border border-border rounded-xl p-4 mb-8 text-left">
              <p className="text-xs text-muted-foreground font-mono mb-3 tracking-widest uppercase">
                {t("result.finalScores")}
              </p>
              <div className="flex flex-col gap-2">
                {sorted.map((p, idx) => (
                  <div
                    key={p.id}
                    data-testid={`row-score-${p.id}`}
                    className={`flex items-center justify-between py-2 px-3 rounded-lg ${
                      idx === 0 ? "bg-primary/10 border border-primary/30" : "border border-transparent"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-muted-foreground w-4">{idx + 1}.</span>
                      <span className={`text-sm font-medium ${p.eliminated ? "line-through text-muted-foreground/50" : ""}`}>
                        {p.name}
                      </span>
                    </div>
                    <span className={`text-sm font-bold font-mono ${idx === 0 ? "text-primary" : "text-muted-foreground"}`}>
                      {p.score}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Multiplayer: everyone can return to lobby */}
          {!isSolo && (
            <button
              data-testid="button-return-lobby"
              onClick={handleReturnToLobby}
              className="w-full py-4 rounded-xl font-semibold text-lg bg-primary text-primary-foreground hover:opacity-90 active:scale-[0.98] transition-all animate-glow-primary mb-3"
            >
              {t("result.returnToLobby")}
            </button>
          )}

          <button
            data-testid="button-play-again"
            onClick={handlePlayAgain}
            className={`w-full py-4 rounded-xl font-semibold text-lg transition-all active:scale-[0.98] ${
              isSolo
                ? "bg-primary text-primary-foreground hover:opacity-90 animate-glow-primary"
                : "bg-card border border-border text-muted-foreground hover:text-foreground hover:border-primary/50"
            }`}
          >
            {t("result.playAgain")}
          </button>
        </div>
      </div>
    </div>
  );
}
