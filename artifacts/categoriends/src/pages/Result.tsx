import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useTranslation } from "@/i18n/translations";
import { useGame } from "@/context/GameContext";
import { useAuth } from "@/context/AuthContext";
import { MAIN_CATEGORIES_EN, MAIN_CATEGORIES_TR } from "@/lib/constants";

interface DailySubmitResult {
  saved: boolean;
  attemptsLeft: number;
  bestScore: number;
  rank?: number;
}

export default function Result() {
  const { t } = useTranslation();
  const { room, gameState, player, setRoom, setGameState, setEloDeltas, eloDeltas, soloToken, setSoloToken, isDailyMode, setIsDailyMode, disconnectWs, ws } = useGame();
  const { user, refetch: refetchAuth } = useAuth();
  const [, setLocation] = useLocation();

  const isSolo = room?.mode === "solo";
  const isQuickMatch = room?.quickMatch === true;
  const score = isSolo ? (gameState?.acceptedAnswers.length ?? 0) : 0;
  const subcategory = gameState?.subcategory ?? "";
  const timeSeconds = room?.timeSeconds ?? 15;

  const allPlayers = room?.players ?? [];
  const sorted = [...allPlayers].sort((a, b) => b.score - a.score);
  const winner = isSolo ? player : sorted[0];

  const allPresets = [...MAIN_CATEGORIES_EN, ...MAIN_CATEGORIES_TR];
  const isCustom = !isDailyMode && (room?.customSubcategory ?? (room ? !allPresets.includes(room.category) : false));

  const [soloEloResult, setSoloEloResult] = useState<{ delta: number; eloAfter: number } | null>(null);
  const [dailyResult, setDailyResult] = useState<DailySubmitResult | null>(null);
  const soloEloCalledRef = useRef(false);
  const dailySubmitCalledRef = useRef(false);

  // Daily mode: submit score to /api/daily/submit
  useEffect(() => {
    if (!isDailyMode || !isSolo || dailySubmitCalledRef.current) return;
    dailySubmitCalledRef.current = true;
    if (!user) return; // guests don't save
    fetch("/api/daily/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ score }),
    })
      .then((r) => r.json())
      .then((data: DailySubmitResult) => {
        setDailyResult(data);
      })
      .catch(() => {});
  }, [isDailyMode, isSolo, user, score]);

  // Regular solo Elo recording (skipped for daily mode)
  useEffect(() => {
    if (isDailyMode || !isSolo || !user || soloEloCalledRef.current) return;
    if (!soloToken) return;
    soloEloCalledRef.current = true;
    const tokenToUse = soloToken;
    setSoloToken(null);
    fetch("/api/elo/record-solo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ answerCount: score, roomCode: "SOLO", isCustom, token: tokenToUse, timeSeconds }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.delta !== undefined && data.eloAfter !== undefined) {
          setSoloEloResult({ delta: data.delta, eloAfter: data.eloAfter });
          refetchAuth();
        }
      })
      .catch(() => {});
  }, [soloToken]);

  useEffect(() => {
    if (!ws || isSolo) return;
    const handleMsg = (evt: MessageEvent) => {
      try {
        const data = JSON.parse(evt.data);
        if (data.type === "room_reset" && data.room) {
          setRoom(data.room);
          setGameState(null);
          setEloDeltas(null);
          setLocation(`/room/${data.room.code}`);
        }
        if (data.type === "player_left" && data.room) {
          setRoom(data.room);
        }
      } catch {}
    };
    ws.addEventListener("message", handleMsg);
    return () => ws.removeEventListener("message", handleMsg);
  }, [ws, isSolo, setRoom, setGameState, setEloDeltas, setLocation]);

  function handleExit() {
    disconnectWs();
    setRoom(null);
    setGameState(null);
    setEloDeltas(null);
    setIsDailyMode(false);
    if (isDailyMode) {
      setLocation("/daily");
    } else {
      setLocation("/");
    }
  }

  // Quick match: auto-redirect home after 8s
  useEffect(() => {
    if (!isQuickMatch || isSolo) return;
    const timer = setTimeout(() => {
      handleExit();
    }, 8000);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isQuickMatch, isSolo]);

  function handleReturnToLobby() {
    if (!ws || !room) return;
    ws.send(JSON.stringify({ type: "reset_room", roomCode: room.code }));
  }

  function EloDeltaBadge({ delta }: { delta: number }) {
    if (delta === 0) return null;
    const positive = delta > 0;
    return (
      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold font-mono border ${
        positive
          ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-400"
          : "bg-destructive/15 border-destructive/40 text-destructive"
      }`}>
        {positive ? "+" : ""}{delta}
      </span>
    );
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
                  <div className="flex items-center justify-center gap-2 mt-1">
                    <span className="text-muted-foreground text-xs font-mono">{t("result.time")}</span>
                    <span className="text-sm font-bold font-mono text-foreground/80">
                      {room?.impossibleMode ? t("setup.impossible") : `${timeSeconds}s`}
                    </span>
                  </div>
                  {subcategory && (
                    <p className="text-muted-foreground text-xs font-mono mt-3">
                      <span className="text-muted-foreground/60">{t("result.subcategory")}</span>{" "}
                      <span className="text-foreground/80">{subcategory}</span>
                    </p>
                  )}

                  {/* Daily mode result */}
                  {isDailyMode && (
                    <div className="mt-5 bg-card border border-accent/30 rounded-xl p-4 text-left flex flex-col gap-2">
                      {user ? (
                        dailyResult ? (
                          <>
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-mono text-muted-foreground">{t("daily.submitted")}</span>
                              {dailyResult.rank && (
                                <span className="text-xs font-mono font-bold text-accent">
                                  {t("daily.rank").replace("{n}", String(dailyResult.rank))}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-xs text-muted-foreground">
                                {t("daily.yourBest").replace("{n}", String(dailyResult.bestScore))}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {dailyResult.attemptsLeft > 0
                                  ? t("daily.attemptsLeft").replace("{n}", String(dailyResult.attemptsLeft))
                                  : t("daily.noAttemptsLeft")}
                              </span>
                            </div>
                          </>
                        ) : (
                          <span className="text-xs text-muted-foreground font-mono text-center">Kaydediliyor...</span>
                        )
                      ) : (
                        <p className="text-xs text-muted-foreground text-center">
                          {t("daily.guestScore").replace("{n}", String(score))}
                        </p>
                      )}
                    </div>
                  )}

                  {/* Regular solo Elo (only for non-daily) */}
                  {!isDailyMode && user && !isCustom && soloEloResult && (
                    <div className="mt-4 flex items-center justify-center gap-2">
                      <span className="text-xs text-muted-foreground font-mono">{t("auth.elo")}</span>
                      <EloDeltaBadge delta={soloEloResult.delta} />
                      <span className="text-xs text-muted-foreground font-mono">
                        {t("elo.new").replace("{n}", String(soloEloResult.eloAfter))}
                      </span>
                    </div>
                  )}
                  {!isDailyMode && isCustom && (
                    <p className="text-xs text-muted-foreground/50 font-mono mt-3">
                      {t("elo.noRating")}
                    </p>
                  )}
                  {!isDailyMode && !user && (
                    <p className="text-xs text-muted-foreground/50 font-mono mt-3">{t("auth.loginToTrackElo")}</p>
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
                {sorted.map((p, idx) => {
                  const delta = eloDeltas ? (eloDeltas[p.id] ?? null) : null;
                  return (
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
                      <div className="flex items-center gap-2">
                        {delta !== null && <EloDeltaBadge delta={delta} />}
                        <span className={`text-sm font-bold font-mono ${idx === 0 ? "text-primary" : "text-muted-foreground"}`}>
                          {p.score}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
              {isCustom && (
                <p className="text-xs text-muted-foreground/50 font-mono mt-3 text-center">
                  {t("elo.noRating")}
                </p>
              )}
              {!user && !isCustom && (
                <p className="text-xs text-muted-foreground/50 font-mono mt-3 text-center">{t("auth.loginToTrackElo")}</p>
              )}
            </div>
          )}

          {!isSolo && !isQuickMatch && (
            <button
              data-testid="button-return-lobby"
              onClick={handleReturnToLobby}
              className="w-full py-4 rounded-xl font-semibold text-lg bg-primary text-primary-foreground hover:opacity-90 active:scale-[0.98] transition-all animate-glow-primary mb-3"
            >
              {t("result.returnToLobby")}
            </button>
          )}
          {isQuickMatch && (
            <p className="text-xs text-muted-foreground/50 font-mono text-center mb-3">
              {t("quickmatch.returningHome")}
            </p>
          )}

          <button
            data-testid="button-play-again"
            onClick={handleExit}
            className={`w-full py-4 rounded-xl font-semibold text-lg transition-all active:scale-[0.98] ${
              isSolo
                ? "bg-primary text-primary-foreground hover:opacity-90 animate-glow-primary"
                : "bg-card border border-border text-muted-foreground hover:text-foreground hover:border-primary/50"
            }`}
          >
            {isDailyMode ? t("nav.back") : t("result.playAgain")}
          </button>
        </div>
      </div>
    </div>
  );
}
