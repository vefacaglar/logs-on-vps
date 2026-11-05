import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { translate, type Key } from "../lib/i18n";
type Language = "tr" | "en";
type Theme = "light" | "dark";
type Preferences = {
  language: Language;
  theme: Theme;
  zone: "local" | "utc";
  setLanguage: (v: Language) => void;
  setTheme: (v: Theme) => void;
  setZone: (v: "local" | "utc") => void;
  t: (key: Key, values?: Record<string, string | number>) => string;
  locale: string;
};
const Context = createContext<Preferences>(null!);
export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(
    document.documentElement.lang === "tr" ? "tr" : "en",
  );
  const [theme, setThemeState] = useState<Theme>(
    document.documentElement.dataset.theme === "light" ? "light" : "dark",
  );
  const [zone, setZoneState] = useState<"local" | "utc">(() => {
    try {
      return localStorage.getItem("logs.zone") === "utc" ? "utc" : "local";
    } catch {
      return "local";
    }
  });
  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dataset.theme = theme;
  }, [language, theme]);
  const save = (key: string, value: string) => {
    try {
      localStorage.setItem(key, value);
    } catch {}
  };
  const setLanguage = (value: Language) => {
    setLanguageState(value);
    save("logs.language", value);
  };
  const setTheme = (value: Theme) => {
    setThemeState(value);
    save("logs.theme", value);
  };
  const setZone = (value: "local" | "utc") => {
    setZoneState(value);
    save("logs.zone", value);
  };
  useEffect(() => {
    const sync = (e: StorageEvent) => {
      if (
        e.key === "logs.language" &&
        (e.newValue === "tr" || e.newValue === "en")
      )
        setLanguageState(e.newValue);
      if (
        e.key === "logs.theme" &&
        (e.newValue === "light" || e.newValue === "dark")
      )
        setThemeState(e.newValue);
      if (
        e.key === "logs.zone" &&
        (e.newValue === "local" || e.newValue === "utc")
      )
        setZoneState(e.newValue);
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  return (
    <Context
      value={{
        language,
        theme,
        zone,
        setLanguage,
        setTheme,
        setZone,
        locale: language === "tr" ? "tr-TR" : "en-GB",
        t: (key, values) => translate(language, key, values),
      }}
    >
      {children}
    </Context>
  );
}
export function usePreferences() {
  return useContext(Context);
}
export function usePageTitle(key: Key) {
  const { t, language } = usePreferences();
  useEffect(() => {
    document.title = `${t(key)} · Logs · Vefa Çağlar`;
  }, [key, language]);
}
