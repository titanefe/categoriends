import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useTranslation } from "@/i18n/translations";
import { useGame, type GameMode, type Room, type Player } from "@/context/GameContext";
import { useAuth } from "@/context/AuthContext";
import { MAIN_CATEGORIES_EN, MAIN_CATEGORIES_TR, RANDOM_CATEGORY_EN, RANDOM_CATEGORY_TR } from "@/lib/constants";

const TIME_OPTIONS = [10, 15, 20, 30, 45, 60];
const IMPOSSIBLE_SENTINEL = -1;

export default function CreateRoom() {
  const { t, lang } = useTranslation();
  const { user } = useAuth();
  const { setRoom, setPlayer, room, connectWs, ws } = useGame();
  const [, setLocation] = useLocation();
  const [mode, setMode] = useState<GameMode>("duel");
  const [selected, setSelected] = useState<string | null>(null);
  const [custom, setCustom] = useState("");
  const [name, setName] = useState("");
  const [timeSeconds, setTimeSeconds] = useState(15);
  const [error, setError] = useState("");
  const isImpossible = timeSeconds === IMPOSSIBLE_SENTINEL;

  const randomLabel = lang === "en" ? RANDOM_CATEGORY_EN : RANDOM_CATEGORY_TR;
  const categories = lang === "en" ? MAIN_CATEGORIES_EN : MAIN_CATEGORIES_TR;
  const allCategories = [randomLabel, ...categories];

  useEffect(() => {
    if (!ws) return;
    const handleMsg = (evt: MessageEvent) => {
      try {
        const data = JSON.parse(evt.data);
        if (data.type === "room_created" && data.room) {
          setRoom(data.room as Room);
          setLocation(`/room/${data.room.code}`);
        }
        if (data.type === "player_joined" && data.room) {
          setRoom(data.room as Room);
        }
      } catch {}
    };
    ws.addEventListener("message", handleMsg);
    return () => ws.removeEventListener("message", handleMsg);
  }, [ws, setRoom, setLocation, room?.timeSeconds]);

  function handleCreate() {
    let category = custom.trim() || selected;
    if (!category) { setError(t("setup.error.selectCategory")); return; }
    if (category === randomLabel) {
      category = MAIN_CATEGORIES_EN[Math.floor(Math.random() * MAIN_CATEGORIES_EN.length)];
    }
    if (!name.trim()) { setError(t("setup.error.enterName")); return; }
    setError("");

    const playerId = `host-${Date.now()}`;
    const p: Player = { id: playerId, name: name.trim(), score: 0, eliminated: false };
    setPlayer(p);

    const socket = connectWs();

    const tryCreate = () => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
          type: "create_room",
          hostId: playerId,
          playerName: name.trim(),
          mode,
          language: lang,
          category,
          timeSeconds: isImpossible ? 18 : timeSeconds,
          impossibleMode: isImpossible,
        }));
      } else if (socket.readyState === WebSocket.CONNECTING) {
        setTimeout(tryCreate, 100);
      } else {
        setError(t("setup.error.connectionFailed"));
      }
    };
    tryCreate();
  }

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4 py-8 overflow-y-auto">
      <div className="w-full max-w-sm py-4">
        <button
          data-testid="button-back"
          onClick={() => setLocation("/")}
          className="text-muted-foreground hover:text-foreground transition-colors text-sm mb-6 flex items-center gap-1"
        >
          &larr; {t("nav.back")}
        </button>

        <h2 className="text-2xl font-bold mb-1">{t("home.createRoom")}</h2>
        <p className="text-muted-foreground text-sm mb-6">{t("setup.createSubtitle")}</p>

        <div className="mb-5">
          <label className="text-xs text-muted-foreground font-mono tracking-widest uppercase block mb-2">
            {t("setup.yourName")}
          </label>
          <input
            data-testid="input-player-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("setup.yourNamePlaceholder")}
            maxLength={20}
            className="w-full px-4 py-3 rounded-lg bg-card border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors"
          />
        </div>

        <div className="mb-5">
          <p className="text-xs text-muted-foreground font-mono tracking-widest uppercase mb-2">{t("setup.mode")}</p>
          <div className="grid grid-cols-2 gap-2">
            {(["duel", "party"] as GameMode[]).map((m) => (
              <button
                key={m}
                data-testid={`button-mode-${m}`}
                onClick={() => setMode(m)}
                className={`py-3 rounded-lg text-sm font-medium border transition-all ${
                  mode === m ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground hover:border-primary/50"
                }`}
              >
                {m === "duel" ? t("setup.mode.duel") : t("setup.mode.party")}
              </button>
            ))}
          </div>
        </div>

        <div className="mb-5">
          <p className="text-xs text-muted-foreground font-mono tracking-widest uppercase mb-2">
            {t("setup.timePerturn")}
          </p>
          <div className="flex gap-2 flex-wrap">
            {TIME_OPTIONS.map((sec) => (
              <button
                key={sec}
                onClick={() => setTimeSeconds(sec)}
                className={`px-3 py-2 rounded-lg text-sm font-mono font-medium border transition-all ${
                  timeSeconds === sec
                    ? "border-accent bg-accent/15 text-accent"
                    : "border-border text-muted-foreground hover:border-accent/50"
                }`}
              >
                {sec}s
              </button>
            ))}
            <button
              onClick={() => setTimeSeconds(IMPOSSIBLE_SENTINEL)}
              className={`px-3 py-2 rounded-lg text-sm font-mono font-medium border transition-all ${
                isImpossible
                  ? "border-destructive bg-destructive/15 text-destructive"
                  : "border-border text-muted-foreground hover:border-destructive/50"
              }`}
            >
              {t("setup.impossible")}
            </button>
          </div>
        </div>

        <div className="mb-5">
          <p className="text-xs text-muted-foreground font-mono tracking-widest uppercase mb-2">{t("setup.chooseCategory")}</p>
          <div className="grid grid-cols-2 gap-2 mb-3">
            {allCategories.map((cat) => (
              <button
                key={cat}
                data-testid={`button-category-${cat}`}
                onClick={() => { setSelected(cat); setCustom(""); }}
                className={`py-2.5 px-2 rounded-lg text-xs font-medium border transition-all ${
                  selected === cat && !custom
                    ? cat === randomLabel
                      ? "border-accent bg-accent/15 text-accent"
                      : "border-primary bg-primary/15 text-primary"
                    : "border-border text-muted-foreground hover:border-primary/50"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
          <input
            data-testid="input-custom-category"
            type="text"
            value={custom}
            onChange={(e) => { setCustom(e.target.value); setSelected(null); }}
            placeholder={t("setup.customCategoryPlaceholder")}
            className="w-full px-4 py-3 rounded-lg bg-card border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors text-sm"
          />
        </div>

        {error && <p data-testid="text-error" className="text-destructive text-sm mb-4">{error}</p>}

        <button
          data-testid="button-create"
          onClick={handleCreate}
          className="w-full py-4 rounded-xl font-semibold text-lg bg-primary text-primary-foreground hover:opacity-90 active:scale-[0.98] transition-all"
        >
          {t("setup.create")}
        </button>
      </div>
    </div>
  );
}
