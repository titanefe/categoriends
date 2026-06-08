import { useEffect } from "react";
import { useLocation, useParams } from "wouter";
import { useTranslation } from "@/i18n/translations";
import { useGame, type Room } from "@/context/GameContext";
import { useGenerateSubcategory } from "@workspace/api-client-react";
import { MAIN_CATEGORIES_EN, MAIN_CATEGORIES_TR } from "@/lib/constants";

export default function RoomLobby() {
  const { t } = useTranslation();
  const { code } = useParams<{ code: string }>();
  const { room, setRoom, player, ws, setGameState } = useGame();
  const [, setLocation] = useLocation();
  const generateMutation = useGenerateSubcategory();

  useEffect(() => {
    if (!ws) return;
    const handleMsg = (evt: MessageEvent) => {
      try {
        const data = JSON.parse(evt.data);
        if (data.type === "player_joined" && data.room) setRoom(data.room as Room);
        if (data.type === "player_left" && data.room) setRoom(data.room as Room);
        if (data.type === "room_reset" && data.room) {
          setRoom(data.room as Room);
          setGameState(null);
        }
        if (data.type === "game_started") {
          setGameState({
            subcategory: data.subcategory,
            currentPlayerId: data.firstPlayerId,
            acceptedAnswers: [],
            timeLeft: room?.timeSeconds ?? 15,
            round: 1,
          });
          setLocation("/game");
        }
      } catch {}
    };
    ws.addEventListener("message", handleMsg);
    return () => ws.removeEventListener("message", handleMsg);
  }, [ws, setRoom, setLocation, setGameState, room?.timeSeconds]);

  const isHost = player?.id === room?.hostId;

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
        <h2 className="text-2xl font-bold mb-1">{t("lobby.waiting")}</h2>
        <p className="text-muted-foreground text-sm mb-6">
          {room.mode === "duel" ? t("setup.mode.duel") : t("setup.mode.party")}
          {" — "}{room.category}
        </p>

        <div className="bg-card border border-primary/30 rounded-xl p-5 mb-6 text-center">
          <p className="text-xs text-muted-foreground font-mono mb-2 tracking-widest uppercase">{t("lobby.code")}</p>
          <p data-testid="text-room-code" className="text-4xl font-mono font-bold text-primary neon-text tracking-widest">
            {room.code}
          </p>
        </div>

        <div className="mb-6">
          <p className="text-xs text-muted-foreground font-mono mb-3 tracking-widest uppercase">{t("lobby.players")}</p>
          <div className="flex flex-col gap-2">
            {room.players.map((p) => (
              <div
                key={p.id}
                data-testid={`row-player-${p.id}`}
                className="flex items-center gap-3 py-2.5 px-3 rounded-lg bg-card border border-border animate-slide-up"
              >
                <div className="w-2 h-2 rounded-full bg-accent" />
                <span className="text-sm font-medium">{p.name}</span>
                {p.id === room.hostId && (
                  <span className="ml-auto text-xs text-primary font-mono">{t("lobby.host")}</span>
                )}
                {p.id === player?.id && p.id !== room.hostId && (
                  <span className="ml-auto text-xs text-muted-foreground font-mono">{t("lobby.you")}</span>
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
