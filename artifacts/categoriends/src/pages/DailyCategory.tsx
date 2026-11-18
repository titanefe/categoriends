import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { useTranslation } from "@/i18n/translations";
import { useGame } from "@/context/GameContext";
import { useAuth } from "@/context/AuthContext";
import AuthModal from "@/components/AuthModal";

interface DailyStatus {
  date: string;
  dayIndex: number;
  category_tr: string;
  category_en: string;
  nextResetAt: number;
}

interface LeaderboardEntry {
  rank: number;
  username: string;
  bestScore: number;
}

interface MyStatus {
  attemptsUsed: number;
  attemptsLeft: number;
  bestScore: number | null;
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return "00:00:00";
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return [h, m, s].map((v) => String(v).padStart(2, "0")).join(":");
}

export default function DailyCategory() {
  const { t, lang } = useTranslation();
  const { setRoom, setPlayer, setGameState, setIsDailyMode } = useGame();
  const { user } = useAuth();
  const [, setLocation] = useLocation();

  const [status, setStatus] = useState<DailyStatus | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [myStatus, setMyStatus] = useState<MyStatus | null>(null);
  const [countdown, setCountdown] = useState("");
  const [loading, setLoading] = useState(true);
  const [showAuth, setShowAuth] = useState(false);

  const fetchAll = useCallback(async () => {
    try {
      const [statusRes, lbRes] = await Promise.all([
        fetch("/api/daily/status", { credentials: "include" }),
        fetch("/api/daily/leaderboard", { credentials: "include" }),
      ]);
      const statusData: DailyStatus = await statusRes.json();
      const lbData: LeaderboardEntry[] = await lbRes.json();
      setStatus(statusData);
      setLeaderboard(lbData);
    } catch {}
  }, []);

  const fetchMyStatus = useCallback(async () => {
    if (!user) { setMyStatus(null); return; }
    try {
      const res = await fetch("/api/daily/my-status", { credentials: "include" });
      if (res.ok) {
        const data: MyStatus = await res.json();
        setMyStatus(data);
      }
    } catch {}
  }, [user]);

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchAll(), fetchMyStatus()]).finally(() => setLoading(false));
  }, [fetchAll, fetchMyStatus]);

  // Re-fetch my-status when user changes (login/logout)
  useEffect(() => {
    fetchMyStatus();
  }, [user, fetchMyStatus]);

  // Server-anchored countdown from nextResetAt
  useEffect(() => {
    if (!status) return;
    const tick = () => {
      const remaining = status.nextResetAt - Date.now();
      setCountdown(formatCountdown(remaining));
      if (remaining <= 0) {
        fetchAll();
        fetchMyStatus();
      }
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [status, fetchAll, fetchMyStatus]);

  function handlePlay() {
    if (!status) return;
    const categoryName = lang === "tr" ? status.category_tr : status.category_en;
    const playerId = `daily-${Date.now()}`;
    const playerName = t("game.soloPlayerName");

    setIsDailyMode(true);
    setPlayer({ id: playerId, name: playerName, score: 0, eliminated: false });
    setRoom({
      code: "DAILY",
      mode: "solo",
      hostId: playerId,
      players: [{ id: playerId, name: playerName, score: 0, eliminated: false }],
      status: "playing",
      subcategory: categoryName,
      category: "daily",
      customSubcategory: true,
      language: lang,
      timeSeconds: 15,
      turnOrder: [],
    });
    setGameState({
      subcategory: categoryName,
      currentPlayerId: playerId,
      acceptedAnswers: [],
      timeLeft: 15,
      round: 1,
      turnStartedAt: Date.now(),
    });
    setLocation("/game");
  }

  const attemptsLeft = myStatus?.attemptsLeft ?? 3;
  const canPlay = attemptsLeft > 0;
  const categoryName = status ? (lang === "tr" ? status.category_tr : status.category_en) : "";

  const medals = ["🥇", "🥈", "🥉"];

  return (
    <div className="min-h-screen bg-background flex flex-col items-center px-4 py-8 relative overflow-hidden">

      <div className="relative z-10 w-full max-w-sm flex flex-col gap-6">
        {/* Back button */}
        <button
          onClick={() => setLocation("/")}
          className="text-muted-foreground hover:text-foreground transition-colors text-sm flex items-center gap-1 self-start"
        >
          &larr; {t("nav.back")}
        </button>

        {/* Header */}
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-lg bg-accent/15 border border-accent/30 mb-3">
            <svg className="w-7 h-7 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-foreground">{t("daily.title")}</h1>
          <p className="text-muted-foreground text-sm mt-1">{t("daily.subtitle")}</p>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <span className="w-6 h-6 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
          </div>
        ) : (
          <>
            {/* Today's category card */}
            <div className="bg-card border border-accent/30 rounded-lg p-5 text-center">
              <p className="text-xs tracking-[0.08em] uppercase text-accent/70 mb-2 font-semibold">
                {t("daily.title")}
              </p>
              <p className="text-2xl font-bold text-foreground mb-4">{categoryName}</p>

              {/* Countdown */}
              <div className="flex flex-col items-center gap-1">
                <p className="text-xs text-muted-foreground font-mono">{t("daily.nextCategory")}</p>
                <p className="text-xl font-bold font-mono text-accent tabular-nums">{countdown}</p>
              </div>
            </div>

            {/* Attempt info + play button */}
            <div className="bg-card border border-border rounded-lg p-5 flex flex-col gap-3">
              {user && (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">
                      {canPlay
                        ? t("daily.attemptsLeft").replace("{n}", String(attemptsLeft))
                        : t("daily.noAttemptsLeft")}
                    </span>
                    {myStatus?.bestScore !== null && myStatus?.bestScore !== undefined && (
                      <span className="text-sm font-mono font-bold text-accent">
                        {t("daily.yourBest").replace("{n}", String(myStatus.bestScore))}
                      </span>
                    )}
                  </div>
                  {/* Attempt dots */}
                  <div className="flex gap-2">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <div
                        key={i}
                        className={`h-1.5 flex-1 rounded-full transition-all ${
                          i < (myStatus?.attemptsUsed ?? 0)
                            ? "bg-accent"
                            : "bg-border"
                        }`}
                      />
                    ))}
                  </div>
                </>
              )}

              <button
                onClick={user ? (canPlay ? handlePlay : undefined) : handlePlay}
                disabled={user !== null && !canPlay}
                className="w-full py-3 rounded-lg font-semibold text-base bg-accent text-accent-foreground hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {canPlay || !user ? t("daily.play") : t("daily.noAttemptsLeft")}
              </button>

              {!user && (
                <button
                  onClick={() => setShowAuth(true)}
                  className="text-xs text-center text-muted-foreground hover:text-primary transition-colors"
                >
                  {t("daily.loginToSave")}
                </button>
              )}
            </div>

            {/* Leaderboard */}
            <div className="bg-card border border-border rounded-lg p-5">
              <p className="text-xs tracking-[0.08em] uppercase text-muted-foreground mb-4 font-semibold">
                {t("daily.leaderboard")}
              </p>
              {leaderboard.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-3">
                  {t("daily.noScores")}
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {leaderboard.map((entry) => (
                    <div
                      key={entry.rank}
                      className={`flex items-center justify-between py-2 px-3 rounded-lg ${
                        entry.rank <= 3
                          ? "bg-accent/8 border border-accent/20"
                          : "border border-transparent"
                      } ${user && entry.username === user.username ? "ring-1 ring-primary/40" : ""}`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="w-6 text-center text-sm">
                          {entry.rank <= 3 ? medals[entry.rank - 1] : `${entry.rank}.`}
                        </span>
                        <span className="text-sm font-medium text-foreground">
                          {entry.username}
                          {user && entry.username === user.username && (
                            <span className="ml-1 text-xs text-primary font-mono">(sen)</span>
                          )}
                        </span>
                      </div>
                      <span className="text-sm font-bold font-mono text-accent">
                        {entry.bestScore}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {showAuth && <AuthModal onClose={() => { setShowAuth(false); fetchMyStatus(); }} />}
    </div>
  );
}
