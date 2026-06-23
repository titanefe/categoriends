import { useState } from "react";
import { useLocation } from "wouter";
import { useTranslation } from "@/i18n/translations";
import { useGame } from "@/context/GameContext";
import { MAIN_CATEGORIES_EN, MAIN_CATEGORIES_TR } from "@/lib/constants";
import { useGenerateSubcategory } from "@workspace/api-client-react";

const TIME_OPTIONS = [10, 15, 20, 30, 45, 60];
const IMPOSSIBLE_SENTINEL = -1;

export default function SoloSetup() {
  const { t, lang } = useTranslation();
  const { setRoom, setPlayer, setGameState } = useGame();
  const [, setLocation] = useLocation();
  const [selected, setSelected] = useState<string | null>(null);
  const [custom, setCustom] = useState("");
  const [timeSeconds, setTimeSeconds] = useState(15);
  const [error, setError] = useState("");
  const isImpossible = timeSeconds === IMPOSSIBLE_SENTINEL;

  const categories = lang === "en" ? MAIN_CATEGORIES_EN : MAIN_CATEGORIES_TR;
  const generateMutation = useGenerateSubcategory();

  async function handleStart() {
    const category = custom.trim() || selected;
    if (!category) {
      setError(t("setup.error.selectCategory"));
      return;
    }
    setError("");

    const playerId = `solo-${Date.now()}`;
    const playerName = t("game.soloPlayerName");
    const actualTimeSeconds = isImpossible ? 18 : timeSeconds;

    setPlayer({ id: playerId, name: playerName, score: 0, eliminated: false });

    if (custom.trim()) {
      const subcategory = custom.trim();
      setRoom({
        code: "SOLO", mode: "solo", hostId: playerId,
        players: [{ id: playerId, name: playerName, score: 0, eliminated: false }],
        status: "playing", subcategory, category, language: lang,
        timeSeconds: actualTimeSeconds, impossibleMode: isImpossible, turnOrder: [],
      });
      setGameState({ subcategory, currentPlayerId: playerId, acceptedAnswers: [], timeLeft: actualTimeSeconds, round: 1, turnStartedAt: Date.now() });
      setLocation("/game");
      return;
    }

    generateMutation.mutate(
      { data: { category, language: lang } },
      {
        onSuccess: (result) => {
          setRoom({
            code: "SOLO",
            mode: "solo",
            hostId: playerId,
            players: [{ id: playerId, name: playerName, score: 0, eliminated: false }],
            status: "playing",
            subcategory: result.subcategory,
            category,
            language: lang,
            timeSeconds: actualTimeSeconds,
            impossibleMode: isImpossible,
            turnOrder: [],
          });
          setGameState({
            subcategory: result.subcategory,
            currentPlayerId: playerId,
            acceptedAnswers: [],
            timeLeft: actualTimeSeconds,
            round: 1,
            turnStartedAt: Date.now(),
          });
          setLocation("/game");
        },
        onError: () => {
          setError("Failed to generate sub-category. Please try again.");
        },
      }
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
          &larr; {t("nav.back")}
        </button>

        <h2 className="text-2xl font-bold mb-1 text-foreground">{t("setup.chooseCategory")}</h2>
        <p className="text-muted-foreground text-sm mb-6">{t("setup.soloMode")}</p>

        <div className="grid grid-cols-2 gap-2 mb-5">
          {categories.map((cat) => (
            <button
              key={cat}
              data-testid={`button-category-${cat}`}
              onClick={() => { setSelected(cat); setCustom(""); }}
              className={`py-3 px-2 rounded-lg text-sm font-medium border transition-all active:scale-[0.97] ${
                selected === cat && !custom
                  ? "border-primary bg-primary/15 text-primary"
                  : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        <div className="mb-5">
          <p className="text-xs text-muted-foreground mb-2 font-mono">{t("setup.customCategory")}</p>
          <input
            data-testid="input-custom-category"
            type="text"
            value={custom}
            onChange={(e) => { setCustom(e.target.value); setSelected(null); }}
            placeholder={t("setup.customCategoryPlaceholder")}
            className="w-full px-4 py-3 rounded-lg bg-card border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors"
          />
        </div>

        <div className="mb-6">
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

        {error && (
          <p data-testid="text-error" className="text-destructive text-sm mb-4">{error}</p>
        )}

        <button
          data-testid="button-start-solo"
          onClick={handleStart}
          disabled={generateMutation.isPending || (!selected && !custom.trim())}
          className="w-full py-4 rounded-xl font-semibold text-lg bg-primary text-primary-foreground hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {generateMutation.isPending ? (
            <span className="flex items-center justify-center gap-2">
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Generating...
            </span>
          ) : t("setup.startSolo")}
        </button>
      </div>
    </div>
  );
}
