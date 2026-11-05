import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { usePageTitle, usePreferences } from "../../app/Preferences";
import { ErrorMessage, PageHeading } from "../../app/Shell";
import { GroupView } from "../../components/LogViews";
import { TimeRange } from "../../components/TimeRange";
import { api, download, display, type LogRow } from "../../lib/api";
import { periodFor, ranges, type Range } from "../../lib/query";
import { useLogs } from "./useLogs";
import styles from "./Console.module.css";
export default function Console() {
  usePageTitle("console");
  const { t, locale, zone } = usePreferences();
  const [params, setParams] = useSearchParams();
  const query = params.get("q") || "",
    service = params.get("service") || "";
  const level = ["error", "warn", "info", "debug"].includes(
    params.get("level") || "",
  )
    ? params.get("level")!
    : "";
  const range = (
    Object.hasOwn(ranges, params.get("range") || "")
      ? params.get("range")
      : "12h"
  ) as Range;
  const [draft, setDraft] = useState(query),
    [period, setPeriod] = useState(() => periodFor(range)),
    [automatic, setAutomatic] = useState(false);
  const panel = useRef<HTMLDivElement>(null),
    sentinel = useRef<HTMLDivElement>(null);
  const result = useLogs({ mode: "console", query, service, level, period });
  const resultRef = useRef(result);
  resultRef.current = result;
  const services = useQuery({
    queryKey: ["services", period.start, period.end],
    queryFn: ({ signal }) =>
      api<{ services: LogRow[] }>(
        "/api/services",
        { query: "", service: "", level: "", ...period, offset: 0 },
        signal,
      ),
    retry: false,
  });
  useEffect(() => setDraft(query), [query]);
  useEffect(() => setPeriod(periodFor(range)), [range]);
  const setFilter = (name: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(name, value);
    else next.delete(name);
    setParams(next, { replace: true });
  };
  useEffect(() => {
    if (!automatic) return;
    const timer = setInterval(() => {
      const r = resultRef.current;
      if (
        !document.hidden &&
        !r.busy &&
        r.rows.length <= 100 &&
        !panel.current?.querySelector("details[open]") &&
        !["INPUT", "SELECT", "TEXTAREA"].includes(
          document.activeElement?.tagName || "",
        )
      )
        setPeriod(periodFor(range));
    }, 5000);
    return () => clearInterval(timer);
  }, [automatic, range]);
  useEffect(() => {
    const scroll = () => {
      const r = resultRef.current;
      if (
        r.hasMore &&
        !r.busy &&
        !r.error &&
        sentinel.current &&
        sentinel.current.getBoundingClientRect().top < innerHeight + 150
      )
        void r.loadMore();
    };
    window.addEventListener("scroll", scroll, { passive: true });
    return () => window.removeEventListener("scroll", scroll);
  }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        e.key === "/" &&
        !e.metaKey &&
        !e.ctrlKey &&
        !["INPUT", "SELECT", "TEXTAREA"].includes(
          document.activeElement?.tagName || "",
        )
      ) {
        e.preventDefault();
        panel.current
          ?.querySelector<HTMLInputElement>("#query-filter")
          ?.focus();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  const items = [...(services.data?.services || [])].sort(
    (a, b) =>
      Number(b.count) - Number(a.count) ||
      display(a.compose_service).localeCompare(display(b.compose_service)),
  );
  const total = items.reduce((sum, row) => sum + Number(row.count || 0), 0);
  const count = (n: number) => new Intl.NumberFormat(locale).format(n);
  const paused =
    result.rows.length > 100 || !!panel.current?.querySelector("details[open]");
  const date = (v: string) =>
    new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: zone === "utc" ? "UTC" : undefined,
    }).format(new Date(v));
  return (
    <div className={styles.workspace}>
      <aside className={styles.sidebar}>
        <p className={styles.sidebarHeading}>
          {t("services")}{" "}
          <span>{items.filter((row) => row.compose_service).length || ""}</span>
        </p>
        <div className={styles.services}>
          {[
            ["", total],
            ...items
              .filter((row) => row.compose_service)
              .map((row) => [display(row.compose_service), Number(row.count)]),
          ].map(([name, n]) => (
            <button
              key={String(name)}
              className={service === name ? styles.selected : ""}
              aria-pressed={service === name}
              onClick={() => setFilter("service", String(name))}
            >
              <span>{name || t("allServices")}</span>
              <span>{count(Number(n))}</span>
            </button>
          ))}
          {service && !items.some((row) => row.compose_service === service) && (
            <button
              className={styles.selected}
              onClick={() => setFilter("service", "")}
            >
              {service} ×
            </button>
          )}
        </div>
        {services.error && <p className={styles.note}>{t("requestFailed")}</p>}
        <div className={styles.tools}>
          <p className="eyebrow">{t("tools")}</p>
          <Link to="/explore">{t("advanced")} ↗</Link>
          <Link to="/overview">{t("overview")} ↗</Link>
        </div>
      </aside>
      <div className={styles.console} ref={panel}>
        <PageHeading
          title={service || t("allLogs")}
          eyebrow={t("serverRecords")}
        >
          <button className="ghost" onClick={() => setPeriod(periodFor(range))}>
            {t("refresh")} ↻
          </button>
        </PageHeading>
        <form
          className={styles.search}
          onSubmit={(e) => {
            e.preventDefault();
            setFilter("q", draft.trim());
          }}
        >
          <label className="sr-only" htmlFor="query-filter">
            {t("queryFilter")}
          </label>
          <input
            id="query-filter"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t("searchPlaceholder")}
            maxLength={4096}
            spellCheck={false}
          />
          <button className="primary">{t("search")} ↵</button>
        </form>
        <div className={styles.filters}>
          <div className={styles.levels} role="group" aria-label={t("level")}>
            {(["", "error", "warn", "info", "debug"] as const).map((value) => (
              <button
                key={value}
                aria-pressed={level === value}
                onClick={() => setFilter("level", value)}
              >
                {t(value === "" ? "all" : value === "warn" ? "warning" : value)}
              </button>
            ))}
          </div>
          <div className={styles.time}>
            <TimeRange
              range={range}
              period={period}
              onRange={(value) => setFilter("range", value)}
            />
            <label className="checkbox">
              <input
                type="checkbox"
                checked={automatic}
                onChange={(e) => setAutomatic(e.target.checked)}
              />
              {t("autoRefresh")}
            </label>
          </div>
        </div>
        <div className={styles.meta} role="status">
          <span>
            {result.busy
              ? t("loading")
              : t("records", { count: count(result.rows.length) })}
            {automatic &&
              ` · ${t(paused ? "refreshPaused" : "refreshedEvery", { seconds: 5 })}`}
          </span>
          <button
            className="text-button"
            disabled={!result.rows.length}
            onClick={() => download(result.rows, "jsonl")}
          >
            {t("downloadJSONL")} ↓
          </button>
        </div>
        <ErrorMessage error={result.error} />
        <div aria-busy={result.busy}>
          <GroupView rows={result.rows} />
          {!result.busy && !result.rows.length && !result.error && (
            <div className="empty">
              <h2>{t("noLogs")}</h2>
              <p>{t("noLogsHelp")}</p>
              <button
                className="ghost"
                onClick={() => {
                  setParams(new URLSearchParams({ range }), { replace: true });
                  setDraft("");
                }}
              >
                {t("clearFilters")}
              </button>
            </div>
          )}
        </div>
        <div ref={sentinel} className={styles.load}>
          {result.hasMore && (
            <button disabled={result.busy} onClick={() => result.loadMore()}>
              {t(result.busy ? "loading" : result.error ? "retry" : "older")} ↓
            </button>
          )}
          {!result.busy && !result.hasMore && result.rows.length > 0 && (
            <p>{t("endResults")}</p>
          )}
        </div>
        <div className={styles.period}>
          <span>{t("newestFirst")}</span>
          <span>
            {date(period.start)} — {date(period.end)}
          </span>
        </div>
      </div>
    </div>
  );
}
