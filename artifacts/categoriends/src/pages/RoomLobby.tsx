import { useEffect, useRef, useCallback, useState } from "react";
import { useLocation, useParams } from "wouter";
import { useTranslation } from "@/i18n/translations";
import { useGame, type Room } from "@/context/GameContext";
import { useGenerateSubcategory } from "@workspace/api-client-react";
import { MAIN_CATEGORIES_EN, MAIN_CATEGORIES_TR } from "@/lib/constants";

const TIME_OPTIONS = [10, 15, 20, 30, 45, 60];

export default function RoomLobby() {
  const { t } = useTranslation();
  const [kickedMsg, setKickedMsg] = useState("");
  const { code } = useParams<{ code: string }>();
  const { room, setRoom, player, ws, setGameState } = useGame();
  const [, setLocation] = useLocation();
  const generateMutation = useGenerateSubcategory();

  const [showSettings, setShowSettings] = useState(false);
  const [settingsCategory, setSettingsCategory] = useState<string>("");
  const [settingsCustom, setSettingsCustom] = useState("");
  const [settingsTime, setSettingsTime] = useState(15);

  // Always-current refs so popstate / beforeunload callbacks are never stale
  const wsRef = useRef(ws);
  const roomRef = useRef(room);
  const playerRef = useRef(player);
  useEffect(() => { wsRef.current = ws; }, [ws]);
  useEffect(() => { roomRef.current = room; }, [room]);
  useEffect(() => { playerRef.current = player; }, [player]);

  const leftRoomSentRef = useRef(false);

  const sendLeaveRoom = useCallback(() => {
    if (leftRoomSentRef.current) return;
    const w = wsRef.current;
    const r = roomRef.current;
    const p = playerRef.current;
    if (!w || !r || !p) return;
    if (r.status !== "waiting") return;
    leftRoomSentRef.current = true;
    try { w.send(JSON.stringify({ type: "leave_room", roomCode: r.code, playerId: p.id })); } catch {}
  }, []);

  useEffect(() => {
    if (room) {
      setSettingsCategory(room.category);
      setSettingsTime(room.timeSeconds ?? 15);
      setSettingsCustom("");
    }
  }, [room?.code]);

  // Intercept browser back button on mobile
  useEffect(() => {
    history.pushState(null, "", window.location.href);
    const handlePopState = () => {
      sendLeaveRoom();
      setLocation("/");
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [sendLeaveRoom, setLocation]);

  // Page close / refresh
  useEffect(() => {
    window.addEventListener("beforeunload", sendLeaveRoom);
    return () => window.removeEventListener("beforeunload", sendLeaveRoom);
  }, [sendLeaveRoom]);

  // Component unmount (programmatic navigation)
  useEffect(() => {
    return () => { sendLeaveRoom(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // If someone navigates to the lobby while a game is in progress, treat them as
  // having left. Send leave_game so other players aren't stuck, then go home.
  useEffect(() => {
    if (!room || !player || !ws) return;
    if (room.status !== "playing") return;
    const inRoom = room.players.some((p) => p.id === player.id && !p.eliminated);
    if (inRoom) {
      try {
        ws.send(JSON.stringify({ type: "leave_game", roomCode: room.code, playerId: player.id }));
      } catch {}
      setLocation("/");
    }
  }, [room?.status, player?.id]);

  useEffect(() => {
    if (!ws) return;
    const handleMsg = (evt: MessageEvent) => {
      try {
        const data = JSON.parse(evt.data);
        if (data.type === "player_joined" && data.room) setRoom(data.room as Room);
        if (data.type === "player_left" && data.room) setRoom(data.room as Room);
        if (data.type === "player_kicked") {
          setKickedMsg(t("lobby.kicked"));
          setTimeout(() => setLocation("/"), 1800);
        }
        if (data.type === "room_reset" && data.room) {
          setRoom(data.room as Room);
          setGameState(null);
          setLocation(`/room/${data.room.code}`);
        }
        if (data.type === "room_settings_updated" && data.room) {
          setRoom(data.room as Room);
        }
        if (data.type === "game_started") {
          setGameState({
            subcategory: data.subcategory,
            currentPlayerId: data.firstPlayerId,
            acceptedAnswers: [],
            timeLeft: room?.timeSeconds ?? 15,
            round: 1,
            turnStartedAt: data.turnStartedAt ?? Date.now(),
          });
          setLocation("/game");
        }
      } catch {}
    };
    ws.addEventListener("message", handleMsg);
    return () => ws.removeEventListener("message", handleMsg);
  }, [ws, setRoom, setLocation, setGameState, room?.timeSeconds]);

  const isHost = player?.id === room?.hostId;
  const categories = room?.language === "tr" ? MAIN_CATEGORIES_TR : MAIN_CATEGORIES_EN;

  function handleKick(targetId: string) {
    if (!ws || !room || !player) return;
    ws.send(JSON.stringify({
      type: "kick_player",
      roomCode: room.code,
      hostId: player.id,
      targetId,
    }));
  }

  function sendSettings() {
    if (!room || !ws || !player) return;
    const category = settingsCustom.trim() || settingsCategory;
    if (!category) return;
    ws.send(JSON.stringify({
      type: "update_room_settings",
      roomCode: room.code,
      playerId: player.id,
      category,
      timeSeconds: settingsTime,
    }));
    setShowSettings(false);
  }

  function handleStart() {
    if (!room || !ws) return;

    const allPresets = [...MAIN_CATEGORIES_EN, ...MAIN_CATEGORIES_TR];
    const isCustom = !allPresets.includes(room.category);

    if (isCustom) {
      ws.send(JSON.stringify({
        type: "start_game",
        roomCode: room.code,
        subcategory: room.category,
      }));
      return;
    }

    generateMutation.mutate(
      { data: { category: room.category, language: room.language } },
      {
        onSuccess: (result) => {
          ws.send(JSON.stringify({
            type: "start_game",
            roomCode: room.code,
            subcategory: result.subcategory,
          }));
        },
      }
    );
  }

  if (kickedMsg) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <p className="text-destructive text-center font-mono text-sm">{kickedMsg}</p>
      </div>
    );
  }

  if (!room) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground font-mono">{t("lobby.loading")}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4 py-8">
      <div className="w-full max-w-sm">
        {/* Header row */}
        <div className="flex items-start justify-between mb-1">
          <h2 className="text-2xl font-bold">{t("lobby.waiting")}</h2>
          {isHost && (
            <button
              onClick={() => setShowSettings((v) => !v)}
              className={`p-2 rounded-lg border transition-all ${
                showSettings
                  ? "border-primary bg-primary/15 text-primary"
                  : "border-border text-muted-foreground hover:border-primary/50 hover:text-primary"
              }`}
              title={t("lobby.settings")}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </button>
          )}
        </div>

        <p className="text-muted-foreground text-sm mb-6">
          {room.mode === "duel" ? t("setup.mode.duel") : t("setup.mode.party")}
          {" — "}{room.category}
          {room.timeSeconds ? ` — ${room.timeSeconds}s` : ""}
        </p>

        {/* Settings panel (host only, collapsible) */}
        {isHost && showSettings && (
          <div className="bg-card border border-primary/30 rounded-xl p-4 mb-6 animate-slide-up">
            <p className="text-xs text-muted-foreground font-mono tracking-widest uppercase mb-4">{t("lobby.settingsTitle")}</p>

            {/* Category */}
            <p className="text-xs text-muted-foreground font-mono mb-2 uppercase tracking-widest">{t("lobby.settingsCategory")}</p>
            <div className="grid grid-cols-2 gap-1.5 mb-3">
              {categories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => { setSettingsCategory(cat); setSettingsCustom(""); }}
                  className={`py-2 px-2 rounded-lg text-xs font-medium border transition-all ${
                    settingsCategory === cat && !settingsCustom
                      ? "border-primary bg-primary/15 text-primary"
                      : "border-border text-muted-foreground hover:border-primary/50"
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
            <input
              type="text"
              value={settingsCustom}
              onChange={(e) => { setSettingsCustom(e.target.value); setSettingsCategory(""); }}
              placeholder={t("lobby.settingsCustom")}
              className="w-full px-3 py-2.5 rounded-lg bg-background border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors text-sm mb-4"
            />

            {/* Time */}
            <p className="text-xs text-muted-foreground font-mono mb-2 uppercase tracking-widest">{t("lobby.settingsTime")}</p>
            <div className="flex gap-1.5 flex-wrap mb-4">
              {TIME_OPTIONS.map((sec) => (
                <button
                  key={sec}
                  onClick={() => setSettingsTime(sec)}
                  className={`px-3 py-2 rounded-lg text-sm font-mono font-medium border transition-all ${
                    settingsTime === sec
                      ? "border-accent bg-accent/15 text-accent"
                      : "border-border text-muted-foreground hover:border-accent/50"
                  }`}
                >
                  {sec}s
                </button>
              ))}
            </div>

            <button
              onClick={sendSettings}
              disabled={!settingsCustom.trim() && !settingsCategory}
              className="w-full py-2.5 rounded-lg font-semibold text-sm bg-primary text-primary-foreground hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-40"
            >
              {t("lobby.settingsDone")}
            </button>
          </div>
        )}

        {/* Room code */}
        <div className="bg-card border border-primary/30 rounded-xl p-5 mb-6 text-center">
          <p className="text-xs text-muted-foreground font-mono mb-2 tracking-widest uppercase">{t("lobby.code")}</p>
          <p data-testid="text-room-code" className="text-4xl font-mono font-bold text-primary neon-text tracking-widest">
            {room.code}
          </p>
        </div>

        {/* Players */}
        <div className="mb-6">
          <p className="text-xs text-muted-foreground font-mono mb-3 tracking-widest uppercase">{t("lobby.players")}</p>
          <div className="flex flex-col gap-2">
            {room.players.map((p) => (
              <div
                key={p.id}
                data-testid={`row-player-${p.id}`}
                className="flex items-center gap-3 py-2.5 px-3 rounded-lg bg-card border border-border animate-slide-up"
              >
                <div className="w-2 h-2 rounded-full bg-accent flex-shrink-0" />
                <span className="text-sm font-medium flex-1 truncate">{p.name}</span>
                {p.id === room.hostId && (
                  <span className="text-xs text-primary font-mono">{t("lobby.host")}</span>
                )}
                {p.id === player?.id && p.id !== room.hostId && (
                  <span className="text-xs text-muted-foreground font-mono">{t("lobby.you")}</span>
                )}
                {isHost && p.id !== player?.id && (
                  <button
                    onClick={() => handleKick(p.id)}
                    className="ml-1 text-destructive/60 hover:text-destructive active:scale-95 transition-all touch-manipulation p-1"
                    title={t("lobby.kick")}
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        {isHost && room.players.length < 2 && (
          <p className="text-muted-foreground text-xs text-center font-mono mb-4">
            {t("lobby.needMorePlayers")}
          </p>
        )}

        {isHost ? (
          <button
            data-testid="button-start-game"
            onClick={handleStart}
            disabled={generateMutation.isPending || room.players.length < 2}
            className="w-full py-4 rounded-xl font-semibold text-lg bg-primary text-primary-foreground hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-40"
          >
            {generateMutation.isPending ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                {t("lobby.generating")}
              </span>
            ) : t("lobby.start")}
          </button>
        ) : (
          <p className="text-center text-muted-foreground text-sm font-mono py-4">
            {t("lobby.waitingToStart")}
          </p>
        )}
      </div>
    </div>
  );
}
