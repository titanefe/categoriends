import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useTranslation } from "@/i18n/translations";
import { useGame, type GameMode, type Room, type Player } from "@/context/GameContext";
import { MAIN_CATEGORIES_EN, MAIN_CATEGORIES_TR } from "@/lib/constants";
import { useGenerateSubcategory } from "@workspace/api-client-react";

export default function CreateRoom() {
  const { t, lang } = useTranslation();
  const { setRoom, setPlayer, player, room, connectWs, ws } = useGame();
  const [, setLocation] = useLocation();
  const [mode, setMode] = useState<GameMode>("duel");
  const [selected, setSelected] = useState<string | null>(null);
  const [custom, setCustom] = useState("");
  const [name, setName] = useState("");
  const [step, setStep] = useState<"setup" | "lobby">("setup");
  const [error, setError] = useState("");
  const [generatedCode, setGeneratedCode] = useState("");
  const wsReadyRef = useRef(false);

  const categories = lang === "en" ? MAIN_CATEGORIES_EN : MAIN_CATEGORIES_TR;
  const generateMutation = useGenerateSubcategory();

  // Listen for room_created message
  useEffect(() => {
    if (!ws) return;
    const handleMsg = (evt: MessageEvent) => {
      try {
        const data = JSON.parse(evt.data);
        if (data.type === "room_created" && data.room) {
          setRoom(data.room as Room);
          setGeneratedCode(data.room.code);
          setStep("lobby");
        }
        if (data.type === "player_joined" && data.room) {
          setRoom(data.room as Room);
        }
        if (data.type === "game_started") {
          setLocation("/game");
        }
      } catch {}
    };
    ws.addEventListener("message", handleMsg);
    return () => ws.removeEventListener("message", handleMsg);
  }, [ws, setRoom, setLocation]);

  async function handleCreate() {
    const category = custom.trim() || selected;
    if (!category) { setError("Please select a category."); return; }
    if (!name.trim()) { setError("Please enter your name."); return; }
    setError("");

    const playerId = `host-${Date.now()}`;
    const p: Player = { id: playerId, name: name.trim(), score: 0, eliminated: false };
    setPlayer(p);
    connectWs();

    // Wait for WS to open then send create
    const tryCreate = () => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: "create_room",
          hostId: playerId,
          playerName: name.trim(),
          mode,
          language: lang,
          category,
        }));
      } else {
        setTimeout(tryCreate, 150);
      }
    };
    setTimeout(tryCreate, 200);
  }

  async function handleStartGame() {
    if (!room || !ws) return;
    const category = room.category;

    generateMutation.mutate(
      { data: { category, language: lang } },
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

  if (step === "lobby") {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4 py-8">
        <div className="w-full max-w-sm">
          <h2 className="text-2xl font-bold mb-1">{t("lobby.waiting")}</h2>
          <p className="text-muted-foreground text-sm mb-6">
            {mode === "duel" ? t("setup.mode.duel") : t("setup.mode.party")}
          </p>

          {/* Room Code */}
          <div className="bg-card border border-primary/30 rounded-xl p-5 mb-6 text-center">
            <p className="text-xs text-muted-foreground font-mono mb-2 tracking-widest uppercase">{t("lobby.code")}</p>
            <p
              data-testid="text-room-code"
              className="text-4xl font-mono font-bold text-primary neon-text tracking-widest"
            >
              {generatedCode}
            </p>
          </div>

          {/* Players list */}
          <div className="mb-6">
            <p className="text-xs text-muted-foreground font-mono mb-3 tracking-widest uppercase">{t("lobby.players")}</p>
            <div className="flex flex-col gap-2">
              {(room?.players ?? []).map((p) => (
                <div
                  key={p.id}
                  data-testid={`row-player-${p.id}`}
                  className="flex items-center gap-3 py-2.5 px-3 rounded-lg bg-card border border-border"
                >
                  <div className="w-2 h-2 rounded-full bg-accent" />
                  <span className="text-sm font-medium text-foreground">{p.name}</span>
                  {p.id === room?.hostId && (
                    <span className="ml-auto text-xs text-primary font-mono">host</span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {generateMutation.isPending && (
            <p className="text-center text-muted-foreground text-sm mb-4 font-mono">Generating sub-category...</p>
          )}

          <button
            data-testid="button-start-game"
            onClick={handleStartGame}
            disabled={generateMutation.isPending || (room?.players.length ?? 0) < 1}
            className="w-full py-4 rounded-xl font-semibold text-lg bg-primary text-primary-foreground hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {t("lobby.start")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4 py-8">
      <div className="w-full max-w-sm">
        <button
          data-testid="button-back"
          onClick={() => setLocation("/")}
          className="text-muted-foreground hover:text-foreground transition-colors text-sm mb-6 flex items-center gap-1"
        >
          &larr; Back
        </button>

        <h2 className="text-2xl font-bold mb-1">{t("home.createRoom")}</h2>
        <p className="text-muted-foreground text-sm mb-6">Set up your game</p>

        {/* Your name */}
        <div className="mb-5">
          <label className="text-xs text-muted-foreground font-mono tracking-widest uppercase block mb-2">Your Name</label>
          <input
            data-testid="input-player-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Enter your name"
            className="w-full px-4 py-3 rounded-lg bg-card border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors"
          />
        </div>

        {/* Mode selection */}
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

        {/* Category selection */}
        <div className="mb-5">
          <p className="text-xs text-muted-foreground font-mono tracking-widest uppercase mb-2">{t("setup.chooseCategory")}</p>
          <div className="grid grid-cols-2 gap-2 mb-3">
            {categories.map((cat) => (
              <button
                key={cat}
                data-testid={`button-category-${cat}`}
                onClick={() => { setSelected(cat); setCustom(""); }}
                className={`py-2.5 px-2 rounded-lg text-xs font-medium border transition-all ${
                  selected === cat && !custom ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground hover:border-primary/50"
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
