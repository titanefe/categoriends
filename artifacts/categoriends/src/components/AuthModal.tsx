import { useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useTranslation } from "@/i18n/translations";

interface AuthModalProps {
  onClose: () => void;
}

export default function AuthModal({ onClose }: AuthModalProps) {
  const { t } = useTranslation();
  const { login, register, logout, user } = useAuth();
  const [tab, setTab] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const result = tab === "login"
      ? await login(username.trim(), password)
      : await register(username.trim(), password);
    setLoading(false);
    if (result.error) {
      setError(result.error);
    } else {
      onClose();
    }
  }

  async function handleLogout() {
    await logout();
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm bg-card border border-border rounded-lg p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {user ? (
          <div className="text-center">
            <p className="text-sm text-muted-foreground font-mono mb-1">{t("auth.loggedInAs")}</p>
            <p className="text-xl font-bold text-foreground mb-1">{user.username}</p>
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/10 border border-primary/30 mb-6">
              <span className="text-xs font-mono text-primary font-bold">{t("auth.elo")} {user.elo}</span>
            </div>
            <button
              onClick={handleLogout}
              className="w-full py-3 rounded-lg font-semibold text-sm border border-destructive/50 text-destructive hover:bg-destructive/10 active:scale-[0.98] transition-all"
            >
              {t("auth.logout")}
            </button>
          </div>
        ) : (
          <>
            <div className="flex gap-1 mb-6 p-1 bg-background rounded-lg border border-border">
              <button
                onClick={() => { setTab("login"); setError(""); }}
                className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all ${tab === "login" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                {t("auth.loginTitle")}
              </button>
              <button
                onClick={() => { setTab("register"); setError(""); }}
                className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all ${tab === "register" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                {t("auth.registerTitle")}
              </button>
            </div>

            <form onSubmit={handleSubmit} className="flex flex-col gap-3">
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder={t("auth.username")}
                autoComplete="username"
                maxLength={30}
                className="w-full px-4 py-3 rounded-lg bg-background border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors"
              />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t("auth.password")}
                autoComplete={tab === "login" ? "current-password" : "new-password"}
                className="w-full px-4 py-3 rounded-lg bg-background border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors"
              />
              {error && <p className="text-destructive text-xs">{error}</p>}
              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 rounded-lg font-semibold text-sm bg-primary text-primary-foreground hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-40"
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  </span>
                ) : tab === "login" ? t("auth.loginBtn") : t("auth.registerBtn")}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
