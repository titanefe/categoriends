import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { useTranslation } from "@/i18n/translations";
import { useGame } from "@/context/GameContext";
import { useVerifyAnswer } from "@workspace/api-client-react";

type AnimState = "idle" | "accepted" | "rejected";

export default function GameScreen() {
  const { t, lang } = useTranslation();
  const { player, room, gameState, setGameState, setRoom, ws } = useGame();
  const [, setLocation] = useLocation();
  const verifyMutation = useVerifyAnswer();

  const [answer, setAnswer] = useState("");
  const [timeLeft, setTimeLeft] = useState(10);
  const [animState, setAnimState] = useState<AnimState>("idle");
  const [rejectionReason, setRejectionReason] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [scores, setScores] = useState<{ id: string; name: string; score: number }[]>([]);

  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeLeftRef = useRef(10);
  const isMyTurn = gameState?.currentPlayerId === player?.id;
  const isSolo = room?.mode === "solo";

  // Sync timeLeft ref
  useEffect(() => { timeLeftRef.current = timeLeft; }, [timeLeft]);

  // Start/reset timer when turn changes
  useEffect(() => {
    if (!gameState) return;
    setTimeLeft(10);
    setAnswer("");
    setAnimState("idle");
    setRejectionReason("");
    setVerifying(false);

    if (timerRef.current) clearInterval(timerRef.current);

    timerRef.current = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timerRef.current!);
          handleTimeOut();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    // Focus input on my turn
    if (gameState.currentPlayerId === player?.id) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }

    return () => { if (timerRef.current) clearInterval(timerRef.current!); };
  }, [gameState?.currentPlayerId, gameState?.round]);

  // WebSocket messages
  useEffect(() => {
    if (!ws || isSolo) return;
    const handleMsg = (evt: MessageEvent) => {
      try {
        const data = JSON.parse(evt.data);
        if (data.type === "turn_passed" && data.room) {
          setRoom(data.room);
          setGameState({
            subcategory: gameState?.subcategory ?? "",
            currentPlayerId: data.nextPlayerId,
            acceptedAnswers: data.room.acceptedAnswers ?? gameState?.acceptedAnswers ?? [],
            timeLeft: 10,
            round: (gameState?.round ?? 1) + 1,
          });
        }
        if (data.type === "player_eliminated" && data.room) {
          setRoom(data.room);
        }
        if (data.type === "game_over") {
          setScores(data.scores ?? []);
          setTimeout(() => setLocation("/result"), 800);
        }
        if (data.type === "answer_result") {
          if (data.valid) {
            triggerAccepted();
          } else {
            triggerRejected(data.reason);
          }
        }
      } catch {}
    };
    ws.addEventListener("message", handleMsg);
    return () => ws.removeEventListener("message", handleMsg);
  }, [ws, isSolo, gameState, setRoom, setGameState, setLocation]);

  function triggerAccepted() {
    setAnimState("accepted");
    setTimeout(() => setAnimState("idle"), 700);
  }

  function triggerRejected(reason: string) {
    setRejectionReason(reason);
    setAnimState("rejected");
    setVerifying(false);
    setTimeout(() => { setAnimState("idle"); setRejectionReason(""); }, 1200);
  }

  const handleTimeOut = useCallback(() => {
    if (!player || !room) return;
    if (isSolo) {
      setLocation("/result");
      return;
    }
    if (timeLeftRef.current > 0) return; // guard against stale closures
    if (isMyTurn && ws) {
      ws.send(JSON.stringify({
        type: "player_eliminated",
        roomCode: room.code,
        playerId: player.id,
      }));
    }
  }, [player, room, isSolo, isMyTurn, ws, setLocation]);

  async function handleSubmit(e?: React.FormEvent) {
    if (e) e.preventDefault();
    const trimmed = answer.trim();
    if (!trimmed || verifying || !isMyTurn) return;

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
              // Solo: advance locally
              if (timerRef.current) clearInterval(timerRef.current);
              setGameState({
                subcategory: gameState!.subcategory,
                currentPlayerId: player!.id,
                acceptedAnswers: [...previousAnswers, trimmed],
                timeLeft: 10,
                round: (gameState?.round ?? 1) + 1,
              });
            } else if (ws && room) {
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
          }
        },
        onError: () => {
          setVerifying(false);
          triggerRejected("Could not verify answer.");
        },
      }
    );
  }

  if (!gameState) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground font-mono">Loading game...</p>
      </div>
    );
  }

  const timerPercent = (timeLeft / 10) * 100;
  const timerColor = timeLeft > 5 ? "hsl(145, 80%, 50%)" : timeLeft > 2 ? "hsl(45, 100%, 60%)" : "hsl(0, 85%, 60%)";
  const isDangerous = timeLeft <= 3;

  const currentPlayer = room?.players?.find((p) => p.id === gameState.currentPlayerId);
  const myTurn = gameState.currentPlayerId === player?.id;

  return (
    <div className="min-h-screen bg-background flex flex-col select-none" style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <div>
          <p className="text-xs text-muted-foreground font-mono tracking-widest uppercase">Sub-category</p>
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
            className={`h-full rounded-full timer-bar ${isDangerous ? "animate-pulse-danger" : ""}`}
            style={{ width: `${timerPercent}%`, backgroundColor: timerColor }}
          />
        </div>
        <div className="flex justify-between mt-1">
          <span className="text-xs text-muted-foreground font-mono">
            {myTurn ? (isDangerous ? "HURRY!" : t("game.yourTurn")) : `${t("game.waiting")} ${currentPlayer?.name ?? ""}...`}
          </span>
          <span
            data-testid="text-timer"
            className={`text-xs font-mono font-bold ${isDangerous ? "text-destructive animate-countdown-tick" : "text-muted-foreground"}`}
          >
            {timeLeft}s
          </span>
        </div>
      </div>

      {/* Players row */}
      {!isSolo && room?.players && (
        <div className="px-4 mb-3 flex gap-2 overflow-x-auto pb-1">
          {room.players.map((p) => (
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
              {p.eliminated && <span className="ml-1 text-xs">{t("game.eliminated")}</span>}
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
              No answers yet — be the first!
            </p>
          )}
        </div>
      </div>

      {/* Rejection reason */}
      {rejectionReason && (
        <div className="px-4 mb-1">
          <p data-testid="text-rejection-reason" className="text-destructive text-xs text-center font-mono">
            {rejectionReason}
          </p>
        </div>
      )}

      {/* Input area */}
      <div className="px-4 pb-4 pt-2" style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom, 1rem))" }}>
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
            disabled={!isMyTurn || verifying || !answer.trim()}
            className="px-5 py-4 rounded-xl bg-primary text-primary-foreground font-semibold text-sm hover:opacity-90 active:scale-[0.96] transition-all disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
          >
            {verifying ? (
              <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin block" />
            ) : t("game.submit")}
          </button>
        </form>
      </div>
    </div>
  );
}
