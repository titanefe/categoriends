import { useState } from "react";
import { useLocation } from "wouter";
import { useTranslation } from "@/i18n/translations";
import { useGame } from "@/context/GameContext";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/hooks/useTheme";
import AuthModal from "@/components/AuthModal";

export default function Home() {
  const { t, lang, setLang } = useTranslation();
  const { setRoom } = useGame();
  const { user, loading: authLoading } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [, setLocation] = useLocation();
  const [showHowTo, setShowHowTo] = useState(false);
  const [showAuth, setShowAuth] = useState(false);

  function handleSolo() {
    setRoom(null);
    setLocation("/solo");
  }

  function handleCreate() {
    setRoom(null);
    setLocation("/room/create");
  }

  function handleJoin() {
    setRoom(null);
    setLocation("/room/join");
  }

  const rules = [
    { title: t("howto.rule1title"), body: t("howto.rule1") },
    { title: t("howto.rule2title"), body: t("howto.rule2") },
    { title: t("howto.rule3title"), body: t("howto.rule3") },
    { title: t("howto.rule4title"), body: t("howto.rule4") },
  ];

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4 relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 rounded-full bg-primary/10 blur-3xl" />
        <div className="absolute bottom-1/4 left-1/4 w-64 h-64 rounded-full bg-accent/8 blur-3xl" />
      </div>

      <div className="relative z-10 w-full max-w-sm flex flex-col items-center gap-8">
        {/* Top controls */}
        <div className="w-full flex justify-end gap-2">
          {!authLoading && (
            <button
              data-testid="button-auth"
              onClick={() => setShowAuth(true)}
              className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-sm font-semibold transition-all active:scale-[0.98] ${
                user
                  ? "border-primary/50 bg-primary/10 text-primary hover:bg-primary/20 hover:border-primary"
                  : "border-border text-muted-foreground hover:border-primary/50 hover:text-primary"
              }`}
            >
              {user ? (
                <>
                  <span className="text-xs font-mono">{user.username}</span>
                  <span className="text-xs font-mono text-primary/70">{user.elo}</span>
                </>
              ) : (
                <span>{t("auth.loginToTrackElo")}</span>
              )}
            </button>
          )}
          <button
            data-testid="theme-toggle"
            onClick={toggleTheme}
            title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            className="flex items-center justify-center w-10 h-10 rounded-xl border border-primary/50 bg-primary/10 text-primary hover:bg-primary/20 hover:border-primary active:scale-[0.98] transition-all"
          >
            {theme === "dark" ? (
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>
              </svg>
            )}
          </button>
          <button
            data-testid="lang-toggle"
            onClick={() => setLang(lang === "en" ? "tr" : "en")}
            className="flex items-center gap-2 px-4 py-2 rounded-xl border border-primary/50 bg-primary/10 text-primary font-semibold text-sm hover:bg-primary/20 hover:border-primary active:scale-[0.98] transition-all"
          >
            <span className="text-base">{lang === "en" ? "🇹🇷" : "🇬🇧"}</span>
            <span>{lang === "en" ? "Türkçe" : "English"}</span>
          </button>
        </div>

        {/* Title */}
        <div className="text-center">
          <h1
            data-testid="title-main"
            className="text-5xl font-bold tracking-tight neon-text text-primary mb-2"
            style={{ fontFamily: "'Space Mono', monospace" }}
          >
            Categoriends
          </h1>
          <p className="text-muted-foreground text-sm tracking-widest uppercase font-mono">
            {t("app.subtitle")}
          </p>
        </div>

        {/* Action buttons */}
        <div className="w-full flex flex-col gap-3">
          <a
            href="/daily"
            data-testid="button-daily"
            onClick={(e) => { e.preventDefault(); setLocation("/daily"); }}
            className="w-full py-4 rounded-xl font-semibold text-lg border border-accent/50 bg-accent/10 text-accent hover:bg-accent/20 hover:border-accent active:scale-[0.98] transition-all text-center block"
          >
            {t("home.daily")}
          </a>

          <button
            data-testid="button-solo"
            onClick={handleSolo}
            className="w-full py-4 rounded-xl font-semibold text-lg bg-primary text-primary-foreground hover:opacity-90 active:scale-[0.98] transition-all shadow-lg animate-glow-primary"
          >
            {t("home.solo")}
          </button>

          <button
            data-testid="button-create-room"
            onClick={handleCreate}
            className="w-full py-4 rounded-xl font-semibold text-lg border border-primary/40 text-primary hover:bg-primary/10 hover:border-primary active:scale-[0.98] transition-all"
          >
            {t("home.createRoom")}
          </button>

          <button
            data-testid="button-join-room"
            onClick={handleJoin}
            className="w-full py-4 rounded-xl font-semibold text-lg border border-border text-foreground hover:border-accent hover:text-accent active:scale-[0.98] transition-all"
          >
            {t("home.joinRoom")}
          </button>

          <button
            onClick={() => setShowHowTo(true)}
            className="w-full py-3 rounded-xl font-medium text-sm border border-border text-muted-foreground hover:border-primary/50 hover:text-primary active:scale-[0.98] transition-all"
          >
            {t("home.howToPlay")}
          </button>
        </div>

        {/* Footer */}
        <div className="text-center">
          <p className="text-muted-foreground/40 text-xs font-mono">
            v1.0 &mdash; real-time word battles
          </p>
          <a
            href="mailto:mefecetinkaya44@gmail.com"
            className="text-muted-foreground/50 text-xs font-mono hover:text-primary transition-colors mt-1 block"
          >
            {t("home.contact")}: mefecetinkaya44@gmail.com
          </a>
        </div>
      </div>

      {showHowTo && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/70 backdrop-blur-sm"
          onClick={() => setShowHowTo(false)}
        >
          <div
            className="w-full max-w-sm bg-card border border-border rounded-2xl p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-xl font-bold mb-5 text-foreground">{t("howto.title")}</h2>
            <div className="flex flex-col gap-4 mb-6">
              {rules.map((r, i) => (
                <div key={i} className="flex gap-3">
                  <span className="w-6 h-6 rounded-full bg-primary/20 text-primary text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                    {i + 1}
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-foreground mb-0.5">{r.title}</p>
                    <p className="text-xs text-muted-foreground leading-relaxed">{r.body}</p>
                  </div>
                </div>
              ))}
            </div>
            <button
              onClick={() => setShowHowTo(false)}
              className="w-full py-3 rounded-xl font-semibold text-sm bg-primary text-primary-foreground hover:opacity-90 active:scale-[0.98] transition-all"
            >
              {t("howto.close")}
            </button>
          </div>
        </div>
      )}

      {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}
    </div>
  );
}
