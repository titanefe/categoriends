import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { useTranslation } from "@/i18n/translations";
import { useGame } from "@/context/GameContext";
import { useVerifyAnswer } from "@workspace/api-client-react";

type AnimState = "idle" | "accepted" | "rejected";
type GameOverOverlay = { winnerName: string } | null;

export default function GameScreen() {
  const { t, lang } = useTranslation();
  const { player, room, gameState, setGameState, setRoom, setEloDeltas, ws } = useGame();
  const [, setLocation] = useLocation();
  const verifyMutation = useVerifyAnswer();

  const timerMax = room?.timeSeconds ?? 15;

  const [answer, setAnswer] = useState("");
  const [timeLeft, setTimeLeft] = useState(timerMax);
  const [animState, setAnimState] = useState<AnimState>("idle");
  const [rejectionReason, setRejectionReason] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [gameOverOverlay, setGameOverOverlay] = useState<GameOverOverlay>(null);
  const [showCategoryPopup, setShowCategoryPopup] = useState(true);
  const [liveToast, setLiveToast] = useState<{ playerName: string; answer: string; valid: boolean } | null>(null);
  const liveToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const eliminatedSentRef = useRef(false);
  const isEliminatedRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerPausedRef = useRef(true); // starts paused until popup dismissed
  const timeLeftRef = useRef(timerMax);
  const isMyTurnRef = useRef(false);
  const hasShownPopupRef = useRef(false);

  // Always-current refs so WS callbacks and popstate/beforeunload are never stale
  const wsRef = useRef(ws);
  const roomRef = useRef(room);
  const playerRef = useRef(player);
  const gameStateRef = useRef(gameState);
  useEffect(() => { wsRef.current = ws; }, [ws]);
  useEffect(() => { roomRef.current = room; }, [room]);
  useEffect(() => { playerRef.current = player; }, [player]);
  useEffect(() => { gameStateRef.current = gameState; }, [gameState]);

  const isSolo = room?.mode === "solo";
  const isMyTurn = gameState?.currentPlayerId === player?.id;
  const isEliminated = room?.players?.find((p) => p.id === player?.id)?.eliminated ?? false;

  useEffect(() => { timeLeftRef.current = timeLeft; }, [timeLeft]);
  useEffect(() => { isMyTurnRef.current = isMyTurn; }, [isMyTurn]);
  useEffect(() => { isEliminatedRef.current = isEliminated; }, [isEliminated]);

  // Idempotent helper — reads from refs so it's safe to call from any event
  const sendLeaveGame = useCallback(() => {
    if (eliminatedSentRef.current) return;
    const w = wsRef.current;
    const r = roomRef.current;
    const p = playerRef.current;
    if (!w || !r || !p) return;
    if (r.mode === "solo") return;
    if (isEliminatedRef.current) return;
    if (r.status !== "playing") return;
    eliminatedSentRef.current = true;
    try { w.send(JSON.stringify({ type: "leave_game", roomCode: r.code, playerId: p.id })); } catch {}
  }, []);

  // If state was wiped by a page refresh, redirect home after a short grace period
  useEffect(() => {
    if (gameState) return;
    const timer = setTimeout(() => {
      if (!gameState) setLocation("/");
    }, 800);
    return () => clearTimeout(timer);
  }, [gameState, setLocation]);

  // Intercept browser back button — push a dummy state on mount so we get a popstate event
  useEffect(() => {
    history.pushState(null, "", window.location.href);
    const handlePopState = () => {
      sendLeaveGame();
      setLocation("/");
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [sendLeaveGame, setLocation]);

  // Page close / refresh
  useEffect(() => {
    window.addEventListener("beforeunload", sendLeaveGame);
    return () => window.removeEventListener("beforeunload", sendLeaveGame);
  }, [sendLeaveGame]);

  // Component unmount (React navigation without popstate, e.g. programmatic setLocation)
  useEffect(() => {
    return () => { sendLeaveGame(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-dismiss category popup after 3 seconds
  useEffect(() => {
    if (!showCategoryPopup) return;
    const timer = setTimeout(() => dismissPopup(), 3000);
    return () => clearTimeout(timer);
  }, [showCategoryPopup]);

  function dismissPopup() {
    hasShownPopupRef.current = true;
    setShowCategoryPopup(false);
    timerPausedRef.current = false;
    if (isMyTurnRef.current) {
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }, 50);
    }
  }

  // Start/reset timer when turn or round changes
  useEffect(() => {
    if (!gameState) return;

    const max = room?.timeSeconds ?? 15;
    // Use server-anchored timestamp to stay in sync across all clients
    const elapsed = gameState.turnStartedAt
      ? Math.max(0, Math.floor((Date.now() - gameState.turnStartedAt) / 1000))
      : 0;
    const initial = Math.max(1, max - elapsed);
    setTimeLeft(initial);
    timeLeftRef.current = initial;
    eliminatedSentRef.current = false;
    setAnswer("");
    setAnimState("idle");
    setRejectionReason("");
    setVerifying(false);

    // Keep paused until popup dismissed on first load; resume immediately on subsequent turns
    timerPausedRef.current = !hasShownPopupRef.current;

    // Only reset the sent-flag for non-eliminated players
    if (!isEliminatedRef.current) {
      eliminatedSentRef.current = false;
    }

    if (timerRef.current) clearInterval(timerRef.current);

    timerRef.current = setInterval(() => {
      if (timerPausedRef.current) return;
      timeLeftRef.current -= 1;
      setTimeLeft(timeLeftRef.current);
      if (timeLeftRef.current <= 0) {
        clearInterval(timerRef.current!);
        handleTimeOut();
      }
    }, 1000);

    if (gameState.currentPlayerId === player?.id && hasShownPopupRef.current) {
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }, 100);
    }

    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [gameState?.currentPlayerId, gameState?.round]);

  // WebSocket messages (multiplayer)
  // Dependency array is [ws, isSolo] ONLY — all mutable values are read from refs.
  // This prevents the listener from being torn down on every game state change,
  // which would create a window where `game_over` can be silently dropped.
  useEffect(() => {
    if (!ws || isSolo) return;
    const handleMsg = (evt: MessageEvent) => {
      try {
        const data = JSON.parse(evt.data);
        if (data.type === "turn_passed" && data.room) {
          setRoom(data.room);
          const gs = gameStateRef.current;
          setGameState({
            subcategory: gs?.subcategory ?? "",
            currentPlayerId: data.nextPlayerId,
            acceptedAnswers: data.room.acceptedAnswers ?? gs?.acceptedAnswers ?? [],
            timeLeft: roomRef.current?.timeSeconds ?? 15,
            round: (gs?.round ?? 1) + 1,
            turnStartedAt: data.turnStartedAt ?? Date.now(),
          });
        }
        if (data.type === "player_eliminated" && data.room) {
          setRoom(data.room);
          if (data.nextPlayerId) {
            const gs = gameStateRef.current;
            setGameState({
              subcategory: gs?.subcategory ?? "",
              currentPlayerId: data.nextPlayerId,
              acceptedAnswers: gs?.acceptedAnswers ?? [],
              timeLeft: roomRef.current?.timeSeconds ?? 15,
              round: (gs?.round ?? 1) + 1,
              turnStartedAt: data.turnStartedAt ?? Date.now(),
            });
          }
        }
        if (data.type === "game_state_sync" && data.room) {
          // Received after reconnecting — resync room state and timer
          setRoom(data.room);
          const gs = gameStateRef.current;
          if (data.room.status === "playing" && data.room.currentPlayerId) {
            setGameState({
              subcategory: data.room.subcategory ?? gs?.subcategory ?? "",
              currentPlayerId: data.room.currentPlayerId,
              acceptedAnswers: data.room.acceptedAnswers ?? gs?.acceptedAnswers ?? [],
              timeLeft: data.room.timeSeconds ?? 15,
              round: (gs?.round ?? 0) + 100,
              turnStartedAt: data.turnStartedAt ?? Date.now(),
            });
          }
        }
        if (data.type === "game_over") {
          if (timerRef.current) clearInterval(timerRef.current);
          setEloDeltas(data.eloDeltas ?? null);
          setGameOverOverlay({ winnerName: data.winnerName ?? "Nobody" });
          setTimeout(() => setLocation("/result"), 2200);
        }
        if (data.type === "answer_result") {
          if (data.playerId === playerRef.current?.id) {
            // Own answer confirmed by server — just unpause; animations already fired locally
            timerPausedRef.current = false;
          } else {
            // Another player's answer — show a brief toast
            const name = roomRef.current?.players?.find((p) => p.id === data.playerId)?.name ?? "?";
            if (liveToastTimerRef.current) clearTimeout(liveToastTimerRef.current);
            setLiveToast({ playerName: name, answer: data.answer, valid: data.valid });
            liveToastTimerRef.current = setTimeout(() => setLiveToast(null), 2200);
          }
        }
      } catch {}
    };
    ws.addEventListener("message", handleMsg);
    return () => ws.removeEventListener("message", handleMsg);
  }, [ws, isSolo]);

  function triggerAccepted() {
    setAnimState("accepted");
    setTimeout(() => { setAnimState("idle"); inputRef.current?.focus(); }, 600);
  }

  function triggerRejected(reason: string) {
    setRejectionReason(reason);
    setAnimState("rejected");
    setVerifying(false);
    timerPausedRef.current = false;
    setTimeout(() => {
      setAnimState("idle");
      setRejectionReason("");
      inputRef.current?.focus();
    }, 2000);
  }

  const handleTimeOut = useCallback(() => {
    if (!player || !room) return;
    if (isSolo) {
      setLocation("/result");
      return;
    }
    if (eliminatedSentRef.current) return;
    if (isEliminatedRef.current) return; // already eliminated — don't re-send
    if (isMyTurnRef.current && ws) {
      eliminatedSentRef.current = true;
      ws.send(JSON.stringify({
        type: "player_eliminated",
        roomCode: room.code,
        playerId: player.id,
      }));
    }
  }, [player, room, isSolo, ws, setLocation]);

  function handleSubmit(e?: React.FormEvent) {
    if (e) e.preventDefault();
    const trimmed = answer.trim();
    if (!trimmed || verifying || !isMyTurn || isEliminated) return;

    timerPausedRef.current = true;
    setVerifying(true);
    const previousAnswers = gameState?.acceptedAnswers ?? [];

    verifyMutation.mutate(
      {
        data: {
          answer: trimmed,
          subcategory: gameState?.subcategory ?? "",
          previousAnswers,
          language: lang,
        },
      },
      {
        onSuccess: (result) => {
          setVerifying(false);
          if (result.valid) {
            triggerAccepted();
            setAnswer("");
            if (isSolo) {
              if (timerRef.current) clearInterval(timerRef.current);
              timerPausedRef.current = false;
              setGameState({
                subcategory: gameState!.subcategory,
                currentPlayerId: player!.id,
                acceptedAnswers: [...previousAnswers, trimmed],
                timeLeft: timerMax,
                round: (gameState?.round ?? 1) + 1,
                turnStartedAt: Date.now(),
              });
            } else if (ws && room) {
              timerPausedRef.current = false;
              ws.send(JSON.stringify({
                type: "answer_submitted",
                roomCode: room.code,
                playerId: player!.id,
                answer: trimmed,
                valid: true,
                reason: result.reason,
              }));
            }
          } else {
            triggerRejected(result.reason);
            setAnswer("");
            // Broadcast invalid answer so other players can see it as a toast
            if (!isSolo && ws && room) {
              ws.send(JSON.stringify({
                type: "answer_submitted",
                roomCode: room.code,
                playerId: player!.id,
                answer: trimmed,
                valid: false,
                reason: result.reason,
              }));
            }
          }
        },
        onError: () => {
          setVerifying(false);
          timerPausedRef.current = false;
          triggerRejected("Could not verify answer.");
          setAnswer("");
        },
      }
    );
  }

  if (!gameState) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground font-mono">{t("game.loadingGame")}</p>
      </div>
    );
  }

  if (gameOverOverlay) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4 text-center">
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-80 h-80 rounded-full bg-primary/20 blur-3xl animate-pulse" />
        </div>
        <p className="text-xs text-muted-foreground font-mono tracking-widest uppercase mb-4 relative z-10">
          {t("result.title")}
        </p>
        <h1 className="text-5xl font-bold text-primary neon-text relative z-10" style={{ fontFamily: "'Space Mono', monospace" }}>
          {gameOverOverlay.winnerName}
        </h1>
        <p className="text-xl text-foreground mt-3 relative z-10">{t("game.won")}</p>
        <p className="text-xs text-muted-foreground font-mono mt-8 relative z-10">{t("game.goingToResults")}</p>
      </div>
    );
  }

  const timerPercent = (timeLeft / timerMax) * 100;
  const timerColor = timeLeft > timerMax * 0.5
    ? "hsl(145, 80%, 50%)"
    : timeLeft > timerMax * 0.2
    ? "hsl(45, 100%, 60%)"
    : "hsl(0, 85%, 60%)";
  const isDangerous = timeLeft <= Math.ceil(timerMax * 0.2);
  const effectivePaused = timerPausedRef.current;

  const currentPlayer = room?.players?.find((p) => p.id === gameState.currentPlayerId);
  const myTurn = gameState.currentPlayerId === player?.id;

  return (
    <div className="min-h-[100dvh] bg-background flex flex-col select-none">
      {/* Live toast — shows another player's answer result briefly */}
      {liveToast && (
        <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-40 px-4 py-2 rounded-xl text-sm font-mono border shadow-lg transition-all pointer-events-none ${
          liveToast.valid
            ? "bg-emerald-950 border-emerald-500/60 text-emerald-300"
            : "bg-red-950 border-red-500/60 text-red-300"
        }`}>
          <span className="font-semibold">{liveToast.playerName}</span>
          {": "}
          <span className="italic">"{liveToast.answer}"</span>
          {" "}
          {liveToast.valid ? "✓" : "✗"}
        </div>
      )}

      {/* Category popup overlay — shown at game start */}
      {showCategoryPopup && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/90 backdrop-blur-sm"
          onClick={dismissPopup}
        >
          <div className="mx-4 w-full max-w-xs bg-card border border-primary/40 rounded-2xl p-8 text-center shadow-2xl">
            <p className="text-xs text-muted-foreground font-mono tracking-widest uppercase mb-3">
              {t("game.subcategoryLabel")}
            </p>
            <h2 className="text-3xl font-bold text-primary neon-text mb-6" style={{ fontFamily: "'Space Mono', monospace" }}>
              {gameState.subcategory}
            </h2>
            <p className="text-xs text-muted-foreground font-mono">
              {t("game.popupAutoDismiss")}
            </p>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <div>
          <p className="text-xs text-muted-foreground font-mono tracking-widest uppercase">{t("game.subcategoryLabel")}</p>
          <h1
            data-testid="text-subcategory"
            className="text-xl font-bold text-foreground leading-tight mt-0.5"
          >
            {gameState.subcategory}
          </h1>
        </div>
        {isSolo && (
          <div className="text-right">
            <p className="text-xs text-muted-foreground font-mono">Score</p>
            <p data-testid="text-score" className="text-2xl font-bold text-primary font-mono">
              {gameState.acceptedAnswers.length}
            </p>
          </div>
        )}
      </div>

      {/* Timer bar */}
      <div className="px-4 mb-3">
        <div className="h-2 bg-muted rounded-full overflow-hidden">
          <div
            data-testid="timer-bar"
            className={`h-full rounded-full timer-bar ${isDangerous && !effectivePaused ? "animate-pulse-danger" : ""}`}
            style={{ width: `${timerPercent}%`, backgroundColor: verifying ? "hsl(45, 100%, 60%)" : timerColor }}
          />
        </div>
        <div className="flex justify-between mt-1">
          <span className="text-xs text-muted-foreground font-mono">
            {verifying
              ? t("game.checking")
              : myTurn
              ? (isDangerous ? t("game.hurry") : t("game.yourTurn"))
              : `${t("game.waiting")} ${currentPlayer?.name ?? ""}...`}
          </span>
          <span
            data-testid="text-timer"
            className={`text-xs font-mono font-bold ${isDangerous && !verifying ? "text-destructive animate-countdown-tick" : "text-muted-foreground"}`}
          >
            {verifying ? "⏸" : `${timeLeft}s`}
          </span>
        </div>
      </div>

      {/* Players row (multiplayer) — ordered by turn order so left→right = turn flow */}
      {!isSolo && room?.players && (
        <div className="px-4 mb-3 flex gap-2 overflow-x-auto pb-1">
          {(room.turnOrder.length > 0
            ? room.turnOrder.map((id) => room.players.find((p) => p.id === id)).filter((p): p is NonNullable<typeof p> => p != null)
            : room.players
          ).map((p) => (
            <div
              key={p.id}
              data-testid={`status-player-${p.id}`}
              className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                p.eliminated
                  ? "border-destructive/30 text-destructive/50 line-through"
                  : gameState.currentPlayerId === p.id
                  ? "border-primary bg-primary/15 text-primary"
                  : "border-border text-muted-foreground"
              }`}
            >
              <div className={`w-1.5 h-1.5 rounded-full ${
                p.eliminated ? "bg-destructive/40" : gameState.currentPlayerId === p.id ? "bg-primary" : "bg-muted-foreground/40"
              }`} />
              {p.name}
              {p.eliminated && <span className="ml-1">{t("game.eliminated")}</span>}
            </div>
          ))}
        </div>
      )}

      {/* Accepted answers scroll */}
      <div className="flex-1 overflow-y-auto px-4 py-2">
        <div className="flex flex-col-reverse gap-1.5">
          {[...gameState.acceptedAnswers].reverse().map((ans, i) => (
            <div
              key={`${ans}-${i}`}
              data-testid={`text-answer-${i}`}
              className="py-2 px-3 rounded-lg bg-card border border-border text-sm text-foreground animate-slide-up"
            >
              <span className="text-accent/60 font-mono text-xs mr-2">{gameState.acceptedAnswers.length - i}.</span>
              {ans}
            </div>
          ))}
          {gameState.acceptedAnswers.length === 0 && (
            <p className="text-muted-foreground/40 text-xs font-mono text-center py-6">
              {t("game.noAnswersYet")}
            </p>
          )}
        </div>
      </div>

      {/* Spectator banner for eliminated players */}
      {isEliminated && !isSolo ? (
        <div className="px-4 pb-4">
          <div className="w-full py-4 rounded-xl bg-destructive/10 border border-destructive/30 text-destructive text-center text-sm font-medium">
            {t("game.spectatorBanner")}
          </div>
        </div>
      ) : (
        <>
          {/* Rejection reason */}
          {rejectionReason && (
            <div className="px-4 mb-1">
              <p data-testid="text-rejection-reason" className="text-destructive text-xs text-center font-mono">
                {rejectionReason}
              </p>
            </div>
          )}

          {/* Mini timer badge above input */}
          <div className="px-4 pt-1 flex items-center justify-between">
            <span className="text-xs text-muted-foreground font-mono">
              {myTurn ? t("game.yourTurn") : `${t("game.waiting")} ${currentPlayer?.name ?? ""}...`}
            </span>
            <span
              className={`text-sm font-bold font-mono px-2.5 py-0.5 rounded-full border transition-colors ${
                verifying
                  ? "border-yellow-500/40 text-yellow-400 bg-yellow-500/10"
                  : isDangerous
                  ? "border-destructive/40 text-destructive bg-destructive/10 animate-pulse"
                  : "border-border text-muted-foreground bg-card"
              }`}
            >
              {verifying ? "⏸" : `${timeLeft}s`}
            </span>
          </div>

          {/* Input area */}
          <div className="px-4 pt-1.5" style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom, 1rem))" }}>
            <form onSubmit={handleSubmit} className="flex gap-2">
              <div className={`flex-1 relative rounded-xl overflow-hidden transition-all ${
                animState === "accepted" ? "animate-flash-green" : animState === "rejected" ? "animate-flash-red animate-shake" : ""
              }`}>
                <input
                  ref={inputRef}
                  data-testid="input-answer"
                  type="text"
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                  placeholder={isMyTurn ? t("game.answerPlaceholder") : `${t("game.waiting")} ${currentPlayer?.name ?? ""}...`}
                  disabled={!isMyTurn || verifying}
                  className="w-full px-4 py-4 bg-card border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-base rounded-xl"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                />
              </div>
              <button
                data-testid="button-submit-answer"
                type="submit"
                disabled={!isMyTurn || verifying || !answer.trim() || isEliminated}
                className="px-5 py-4 rounded-xl bg-primary text-primary-foreground font-semibold text-sm hover:opacity-90 active:scale-[0.96] transition-all disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
              >
                {verifying ? (
                  <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin block" />
                ) : t("game.submit")}
              </button>
            </form>
          </div>
        </>
      )}
    </div>
  );
}
