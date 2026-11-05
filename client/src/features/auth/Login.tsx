import { useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { signInDestination } from "../../lib/query";
import { usePageTitle, usePreferences } from "../../app/Preferences";
import { Header, ErrorMessage } from "../../app/Shell";
import styles from "./Login.module.css";
export default function Login() {
  const { t } = usePreferences();
  usePageTitle("signIn");
  const [visible, setVisible] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const cache = useQueryClient();
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    setError(undefined);
    try {
      const result = await api<{ username: string }>("/api/login", {
        username: data.get("username"),
        password: data.get("password"),
      });
      cache.setQueryData(["session"], result);
      const next = params.get("next");
      navigate(signInDestination(next, location.hash), { replace: true });
    } catch (e) {
      setError(e);
      const password = form.elements.namedItem("password") as HTMLInputElement;
      password.value = "";
      password.focus();
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={styles.page}>
      <Header />
      <main className={styles.main}>
        <p className="eyebrow">{t("privateAccess")}</p>
        <h1>
          {t("console")}
          <span className="accent">.</span>
        </h1>
        <p className={styles.intro}>{t("signInIntro")}</p>
        <form onSubmit={submit}>
          <label htmlFor="username">{t("username")}</label>
          <input
            id="username"
            name="username"
            autoComplete="username"
            maxLength={64}
            required
            autoFocus
            autoCapitalize="none"
            spellCheck={false}
          />
          <div className={styles.passwordLabel}>
            <label htmlFor="password">{t("password")}</label>
            <button
              type="button"
              className="text-button"
              aria-pressed={visible}
              onClick={() => setVisible(!visible)}
            >
              {t(visible ? "hide" : "show")}
            </button>
          </div>
          <input
            id="password"
            name="password"
            type={visible ? "text" : "password"}
            autoComplete="current-password"
            required
            maxLength={72}
          />
          <ErrorMessage error={error} />
          <button type="submit" className="primary" disabled={busy}>
            {t(busy ? "signingIn" : "signIn")} <span aria-hidden="true">↗</span>
          </button>
        </form>
        <p className={styles.note}>{t("privateNote")}</p>
      </main>
      <footer className={styles.footer}>
        <span>vefacaglar.com</span>
        <span>{t("console")}</span>
      </footer>
    </div>
  );
}
