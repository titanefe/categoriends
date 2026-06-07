import { useState } from "react";
import { useLocation } from "wouter";
import { useTranslation } from "@/i18n/translations";
import { useGame } from "@/context/GameContext";

export default function Home() {
  const { t, lang, setLang } = useTranslation();
  const { setRoom } = useGame();
  const [, setLocation] = useLocation();

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

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4 relative overflow-hidden">
      {/* Background glow */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 rounded-full bg-primary/10 blur-3xl" />
        <div className="absolute bottom-1/4 left-1/4 w-64 h-64 rounded-full bg-accent/8 blur-3xl" />
      </div>

      <div className="relative z-10 w-full max-w-sm flex flex-col items-center gap-8">
        {/* Language toggle */}
        <div className="absolute top-0 right-0" style={{ top: "-3rem" }}>
          <button
            data-testid="lang-toggle"
            onClick={() => setLang(lang === "en" ? "tr" : "en")}
            className="text-xs font-mono tracking-widest px-3 py-1.5 rounded-full border border-border text-muted-foreground hover:border-primary hover:text-primary transition-colors"
          >
            {lang === "en" ? "TR" : "EN"}
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
        </div>

        {/* Footer */}
        <p className="text-muted-foreground/40 text-xs font-mono mt-4">
          v1.0 &mdash; realtme word battles
        </p>
      </div>
    </div>
  );
}
