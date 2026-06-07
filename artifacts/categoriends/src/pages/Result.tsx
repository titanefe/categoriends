import { useLocation } from "wouter";
import { useTranslation } from "@/i18n/translations";
import { useGame } from "@/context/GameContext";

export default function Result() {
  const { t } = useTranslation();
  const { room, gameState, player, setRoom, setGameState, disconnectWs } = useGame();
  const [, setLocation] = useLocation();

  const isSolo = room?.mode === "solo";
  const score = isSolo ? (gameState?.acceptedAnswers.length ?? 0) : 0;

  const allPlayers = room?.players ?? [];
  const sorted = [...allPlayers].sort((a, b) => b.score - a.score);
  const winner = isSolo ? player : sorted[0];

  function handlePlayAgain() {
    disconnectWs();
    setRoom(null);
    setGameState(null);
    setLocation("/");
  }

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm text-center">
        {/* Background glow */}
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
                <div className="flex items-center justify-center gap-2 mt-4">
                  <span className="text-muted-foreground text-sm">{t("result.score")}</span>
                  <span data-testid="text-final-score" className="text-5xl font-bold font-mono text-accent neon-cyan">
                    {score}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Multiplayer scores */}
          {!isSolo && sorted.length > 0 && (
            <div className="bg-card border border-border rounded-xl p-4 mb-8 text-left">
              <p className="text-xs text-muted-foreground font-mono mb-3 tracking-widest uppercase">Final Scores</p>
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

          <button
            data-testid="button-play-again"
            onClick={handlePlayAgain}
            className="w-full py-4 rounded-xl font-semibold text-lg bg-primary text-primary-foreground hover:opacity-90 active:scale-[0.98] transition-all animate-glow-primary"
          >
            {t("result.playAgain")}
          </button>
        </div>
      </div>
    </div>
  );
}
