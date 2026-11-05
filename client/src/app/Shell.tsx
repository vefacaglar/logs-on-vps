import {
  Link,
  NavLink,
  useLocation,
  useNavigate,
  Navigate,
} from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { usePreferences } from "./Preferences";
import { api, ApiError } from "../lib/api";
import { useState, type ReactNode } from "react";
import { clearHistory } from "../lib/sessionHistory";
import styles from "./App.module.css";
import type { Key } from "../lib/i18n";
export function PreferenceControls() {
  const { language, setLanguage, theme, setTheme, t } = usePreferences();
  return (
    <div className={styles.preferences}>
      <label>
        <span className="sr-only">{t("language")}</span>
        <select
          aria-label={t("language")}
          value={language}
          onChange={(e) => setLanguage(e.target.value as "tr" | "en")}
        >
          <option value="tr">TR</option>
          <option value="en">EN</option>
        </select>
      </label>
      <button
        className={styles.theme}
        aria-label={`${t("theme")}: ${t(theme)}`}
        onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          {theme === "dark" ? (
            <>
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" />
            </>
          ) : (
            <path d="M20 15.2A8.5 8.5 0 0 1 8.8 4 8.5 8.5 0 1 0 20 15.2Z" />
          )}
        </svg>
        {t(theme)}
      </button>
    </div>
  );
}
export function Header({ username }: { username?: string }) {
  const { t } = usePreferences();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const cache = useQueryClient();
  const [error, setError] = useState<unknown>();
  async function logout() {
    try {
      await api("/api/logout", {});
      clearHistory();
      cache.clear();
      navigate("/login", { replace: true });
    } catch (e) {
      setError(e);
    }
  }
  return (
    <>
      <header className={styles.header}>
        <nav className={styles.crumbs} aria-label={t("navigation")}>
          <a href="https://vefacaglar.com">Vefa Çağlar</a>
          <span className={styles.separator}>/</span>
          <Link to="/">Logs</Link>
          {pathname !== "/" && pathname !== "/login" && (
            <>
              <span className={styles.separator}>/</span>
              <span className={styles.current}>
                {t(pathname === "/overview" ? "overview" : "advanced")}
              </span>
            </>
          )}
        </nav>
        <div className={styles.controls}>
          <PreferenceControls />
          {username && (
            <>
              <span className={styles.user}>{username}</span>
              <button className="text-button" onClick={logout}>
                {t("signOut")} ↗
              </button>
            </>
          )}
        </div>
      </header>
      {error && <ErrorMessage error={error} />}
    </>
  );
}
export function Shell({
  children,
  username,
}: {
  children: ReactNode;
  username: string;
}) {
  const { t } = usePreferences();
  return (
    <>
      <Header username={username} />
      <div className={styles.layout}>
        <nav className={styles.navigation} aria-label={t("tools")}>
          <NavLink end to="/">
            {t("console")}
          </NavLink>
          <NavLink to="/explore">{t("advanced")}</NavLink>
          <NavLink to="/overview">{t("overview")}</NavLink>
        </nav>
        <main className={styles.main}>{children}</main>
        <footer className={styles.footer}>
          <span>vefacaglar.com / Logs</span>
          <a
            href="https://docs.victoriametrics.com/victorialogs/logsql/"
            target="_blank"
            rel="noreferrer"
          >
            {t("reference")} ↗
          </a>
        </footer>
      </div>
    </>
  );
}
export function PageHeading({
  title,
  eyebrow,
  children,
}: {
  title: string;
  eyebrow?: string;
  children?: ReactNode;
}) {
  return (
    <div className={styles.title}>
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>
          {title}
          <span className="accent">.</span>
        </h1>
      </div>
      <div className={styles.actions}>{children}</div>
    </div>
  );
}
export function ErrorMessage({ error }: { error: unknown }) {
  const { t } = usePreferences();
  const location = useLocation();
  if (!error) return null;
  if (
    error instanceof ApiError &&
    error.status === 401 &&
    location.pathname !== "/login"
  )
    return (
      <Navigate
        replace
        to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`}
      />
    );
  const key: Key = error instanceof ApiError ? error.key : "requestFailed";
  return (
    <div className="error" role="alert">
      {t(key)}
      {error instanceof ApiError && error.message && <pre>{error.message}</pre>}
    </div>
  );
}
