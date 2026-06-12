import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useTranslation } from "@/i18n/translations";
import { useGame, type Room, type Player } from "@/context/GameContext";

export default function JoinRoom() {
  const { t, lang } = useTranslation();
  const { setRoom, setPlayer, connectWs, ws } = useGame();
  const [, setLocation] = useLocation();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    if (!ws) return;
    const handleMsg = (evt: MessageEvent) => {
      try {
        const data = JSON.parse(evt.data);
        if (data.type === "room_state" && data.room) {
          setRoom(data.room as Room);
          setLocation(`/room/${data.room.code}`);
        }
        if (data.type === "error") {
          setError(
            data.message === "wrong_language"
              ? t("join.error.wrongLanguage")
              : data.message === "room_full"
              ? t("join.error.roomFull")
              : data.message || "Failed to join room."
          );
          setJoining(false);
        }
        if (data.type === "game_started") {
          setLocation("/game");
        }
      } catch {}
    };
    ws.addEventListener("message", handleMsg);
    return () => ws.removeEventListener("message", handleMsg);
  }, [ws, setRoom, setLocation]);

  function handleJoin() {
    if (!code.trim()) { setError(t("join.error.enterCode")); return; }
    if (!name.trim()) { setError(t("join.error.enterName")); return; }
    setError("");
    setJoining(true);

    const playerId = `player-${Date.now()}`;
    const p: Player = { id: playerId, name: name.trim(), score: 0, eliminated: false };
    setPlayer(p);

    const socket = connectWs();

    const tryJoin = () => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
          type: "join",
          roomCode: code.trim().toUpperCase(),
          playerId,
          playerName: name.trim(),
          language: lang,
        }));
      } else if (socket.readyState === WebSocket.CONNECTING) {
        setTimeout(tryJoin, 100);
      } else {
        setError(t("setup.error.connectionFailed"));
        setJoining(false);
      }
    };
    tryJoin();
  }

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <button
          data-testid="button-back"
          onClick={() => setLocation("/")}
          className="text-muted-foreground hover:text-foreground transition-colors text-sm mb-6 flex items-center gap-1"
        >
          &larr; {t("nav.back")}
        </button>

        <h2 className="text-2xl font-bold mb-1">{t("join.title")}</h2>
        <p className="text-muted-foreground text-sm mb-6">{t("join.subtitle")}</p>

        <div className="flex flex-col gap-4 mb-6">
          <input
            data-testid="input-room-code"
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder={t("join.codePlaceholder")}
            maxLength={6}
            className="w-full px-4 py-4 rounded-lg bg-card border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors text-center text-2xl font-mono tracking-widest"
          />
          <input
            data-testid="input-player-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("join.namePlaceholder")}
            maxLength={20}
            className="w-full px-4 py-3 rounded-lg bg-card border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors"
          />
        </div>

        {error && <p data-testid="text-error" className="text-destructive text-sm mb-4">{error}</p>}

        <button
          data-testid="button-join"
          onClick={handleJoin}
          disabled={joining}
          className="w-full py-4 rounded-xl font-semibold text-lg bg-primary text-primary-foreground hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-40"
        >
          {joining ? (
            <span className="flex items-center justify-center gap-2">
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              {t("join.joining")}
            </span>
          ) : t("join.button")}
        </button>
      </div>
    </div>
  );
}
