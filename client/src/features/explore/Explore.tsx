import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { usePageTitle, usePreferences } from "../../app/Preferences";
import { ErrorMessage, PageHeading } from "../../app/Shell";
import { Dialog } from "../../components/Dialog";
import { QueryEditor } from "../../components/QueryEditor";
import { TimeRange } from "../../components/TimeRange";
import { Histogram } from "../../components/Histogram";
import { GroupView, TableView, JSONView } from "../../components/LogViews";
import { download, engine, fieldsOf, type LogRow } from "../../lib/api";
import {
  addFieldFilter,
  legacyParams,
  periodFor,
  ranges,
  validPeriod,
  type Period,
  type Range,
} from "../../lib/query";
import { useLogs } from "../logs/useLogs";
import { Live } from "./Live";
import styles from "./Explore.module.css";
import {
  getHistory,
  rememberQuery,
  clearHistory,
} from "../../lib/sessionHistory";
type View = "group" | "table" | "json" | "live";

export default function Explore() {
  const sessionHistory = getHistory();
  usePageTitle("advanced");
  const { t, locale, zone, setZone } = usePreferences();
  const [params, setParams] = useSearchParams();
  const query = params.get("q") || "*";
  const range = (
    Object.hasOwn(ranges, params.get("range") || "")
      ? params.get("range")
      : "12h"
  ) as Range;
  const view = (
    ["group", "table", "json", "live"].includes(params.get("view") || "")
      ? params.get("view")
      : "group"
  ) as View;
  const [draft, setDraft] = useState(query);
  const custom = {
    start: params.get("start") || "",
    end: params.get("end") || "",
  };
  const [period, setPeriod] = useState<Period>(() =>
    validPeriod(custom) ? custom : periodFor(range),
  );
  const [limit, setLimit] = useState(100),
    [wrap, setWrap] = useState(false),
    [chart, setChart] = useState(true),
    [sidebar, setSidebar] = useState(() => innerWidth > 900),
    [settings, setSettings] = useState(false),
    [history, setHistory] = useState(false),
    [examples, setExamples] = useState(false),
    [groupBy, setGroupBy] = useState(""),
    [fieldFilter, setFieldFilter] = useState(""),
    [automatic, setAutomatic] = useState(false),
    [historyVersion, setHistoryVersion] = useState(0);
  const content = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (location.hash) {
      const legacy = legacyParams(location.hash);
      if (legacy.size) {
        historyReplace(legacy);
      }
    }
    function historyReplace(next: URLSearchParams) {
      window.history.replaceState(null, "", "/explore?" + next);
      setParams(next, { replace: true });
    }
  }, []);
  useEffect(() => setDraft(query), [query]);
  useEffect(() => {
    const next = {
      start: params.get("start") || "",
      end: params.get("end") || "",
    };
    setPeriod(validPeriod(next) ? next : periodFor(range));
  }, [range, params.get("start"), params.get("end")]);
  const result = useLogs({ mode: "engine", query, period, limit });
  const resultRef = useRef(result);
  resultRef.current = result;
  const fieldQuery = useQuery({
    queryKey: ["fieldNames", period.start, period.end],
    queryFn: ({ signal }) =>
      engine<{ values: { value: string; hits: number }[] }>(
        "field_names",
        { query: "*", ...period, timeout: "20s" },
        signal,
      ),
    retry: false,
    staleTime: 30000,
  });
  const fields = useMemo(
    () =>
      fieldQuery.data?.values.map((row) => row.value).slice(0, 500) ||
      fieldsOf(result.rows),
    [fieldQuery.data, result.rows],
  );
  const change = (values: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(values)) {
      if (value === null || value === "") next.delete(key);
      else next.set(key, value);
    }
    setParams(next, { replace: true });
  };
  const run = (value = draft) => {
    const q = value.trim() || "*";
    rememberQuery(q);
    setHistoryVersion((v) => v + 1);
    setDraft(q);
    if (q === query) {
      if (params.has("start")) result.refresh();
      else setPeriod(periodFor(range));
    } else change({ q });
  };
  const setCustom = (next: Period) => {
    change({ start: next.start, end: next.end });
    setPeriod(next);
  };
  useEffect(() => {
    if (!automatic || view === "live") return;
    const timer = setInterval(() => {
      const r = resultRef.current;
      if (
        !document.hidden &&
        !r.busy &&
        r.rows.length <= limit &&
        !content.current?.querySelector("details[open]") &&
        !content.current?.contains(
          document.activeElement?.closest(".cm-editor") || null,
        ) &&
        !params.has("start")
      )
        setPeriod(periodFor(range));
    }, 5000);
    return () => clearInterval(timer);
  }, [automatic, view, limit, range, params.has("start")]);
  const onFilter = (field: string, value: string, exclude = false) =>
    run(addFieldFilter(draft, field, value, exclude));
  const number = (value: number) => new Intl.NumberFormat(locale).format(value);
  const date = (value: string) =>
    new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: zone === "utc" ? "UTC" : undefined,
    }).format(new Date(value));
  const views = { group: GroupView, table: TableView, json: JSONView };
  const ViewComponent = view === "live" ? null : views[view];
  return (
    <>
      <PageHeading title={t("advanced")} eyebrow={t("advancedIntro")}>
        <TimeRange
          range={params.has("start") ? "custom" : range}
          period={period}
          onRange={(next) => change({ range: next, start: null, end: null })}
          onPeriod={setCustom}
        />
        <button className="ghost" onClick={() => setSettings(true)}>
          {t("settings")}
        </button>
      </PageHeading>
      <div className={sidebar ? styles.workspace : styles.fullWorkspace}>
        <aside className={styles.sidebar} hidden={!sidebar}>
          <div className={styles.sidebarTitle}>
            <h2>{t("fields")}</h2>
            <button
              className="text-button"
              onClick={() => setSidebar(false)}
              aria-label={t("hideFilters")}
            >
              ×
            </button>
          </div>
          <input
            aria-label={t("searchFields")}
            placeholder={t("searchFields")}
            value={fieldFilter}
            onChange={(e) => setFieldFilter(e.target.value)}
          />
          {fieldQuery.error && <ErrorMessage error={fieldQuery.error} />}
          <div className={styles.fieldList}>
            {fields
              .filter((field) =>
                field
                  .toLocaleLowerCase()
                  .includes(fieldFilter.toLocaleLowerCase()),
              )
              .map((field) => (
                <button
                  key={field}
                  title={field}
                  onClick={() =>
                    setDraft((value) =>
                      value === "*" ? `${field}:` : value + ` ${field}:`,
                    )
                  }
                >
                  {field}
                  <span>+</span>
                </button>
              ))}
            {!fields.length && (
              <p>{t(fieldQuery.isPending ? "loading" : "noFields")}</p>
            )}
          </div>
        </aside>
        <div className={styles.content} ref={content}>
          <section className={styles.editor}>
            <div className={styles.editorHeading}>
              <label>{t("query")}</label>
              <span>{t("queryHelp")}</span>
            </div>
            <QueryEditor
              value={draft}
              onChange={setDraft}
              onRun={() => run()}
              fields={fields}
              wrap={wrap}
            />
            <div className={styles.editorTools}>
              <button className="ghost" onClick={() => setSidebar(!sidebar)}>
                {t(sidebar ? "hideFilters" : "showFilters")}
              </button>
              <button className="text-button" onClick={() => setExamples(true)}>
                {t("examples")}
              </button>
              <button className="text-button" onClick={() => setHistory(true)}>
                {t("history")}
              </button>
              <label>
                {t("limit")}
                <select
                  aria-label={t("limit")}
                  value={limit}
                  onChange={(e) => setLimit(Number(e.target.value))}
                >
                  {[100, 250, 500, 1000].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className={result.busy ? "ghost" : "primary"}
                onClick={() => (result.busy ? result.stop() : run())}
              >
                {t(result.busy ? "stop" : "run")} {result.busy ? "■" : "↵"}
              </button>
            </div>
          </section>
          <ErrorMessage error={result.error} />
          {chart && view !== "live" && (
            <Histogram
              query={query}
              period={period}
              groupBy={groupBy}
              onPeriod={setCustom}
            />
          )}
          <section className={styles.results}>
            <div className={styles.resultHeader}>
              <div
                role="tablist"
                aria-label={t("rows")}
                className={styles.tabs}
              >
                {(["group", "table", "json", "live"] as View[]).map((item) => (
                  <button
                    key={item}
                    role="tab"
                    aria-selected={view === item}
                    onClick={() => change({ view: item })}
                  >
                    {t(item)}
                  </button>
                ))}
              </div>
              {view !== "live" && (
                <div className={styles.resultActions}>
                  <button
                    className="text-button"
                    disabled={!result.rows.length}
                    onClick={() => download(result.rows, "jsonl")}
                  >
                    {t("downloadJSONL")} ↓
                  </button>
                  <button
                    className="text-button"
                    disabled={!result.rows.length}
                    onClick={() => download(result.rows, "csv")}
                  >
                    {t("downloadCSV")} ↓
                  </button>
                </div>
              )}
            </div>
            {view === "live" ? (
              <Live query={query} wrap={wrap} />
            ) : (
              <>
                <div className={styles.resultMeta} role="status">
                  <span>
                    {result.busy
                      ? t("loading")
                      : t("resultInfo", {
                          count: number(result.rows.length),
                          duration: result.duration,
                        })}
                  </span>
                  <label>
                    {t("groupBy")}
                    <select
                      aria-label={t("groupBy")}
                      value={groupBy}
                      onChange={(e) => setGroupBy(e.target.value)}
                    >
                      <option value="">{t("none")}</option>
                      {fields
                        .filter(
                          (key) =>
                            !["_time", "_msg", "_stream_id"].includes(key),
                        )
                        .map((key) => (
                          <option key={key}>{key}</option>
                        ))}
                    </select>
                  </label>
                </div>
                <div role="tabpanel" aria-busy={result.busy}>
                  {ViewComponent && (
                    <ViewComponent
                      rows={result.rows}
                      groupBy={groupBy}
                      wrap={wrap}
                      onFilter={onFilter}
                    />
                  )}
                </div>
                {!result.busy && !result.rows.length && !result.error && (
                  <div className="empty">
                    <h2>{t("noLogs")}</h2>
                    <p>{t("noLogsHelp")}</p>
                  </div>
                )}
                <div className={styles.load}>
                  {result.hasMore ? (
                    <button
                      disabled={result.busy}
                      onClick={() => result.loadMore()}
                    >
                      {t(result.busy ? "loading" : "older")} ↓
                    </button>
                  ) : (
                    result.rows.length > 0 &&
                    !result.busy && <span>{t("endResults")}</span>
                  )}
                </div>
              </>
            )}
          </section>
          <p className={styles.period}>
            {date(period.start)} — {date(period.end)}
            {automatic &&
              result.rows.length > limit &&
              ` · ${t("paginationPaused")}`}
          </p>
        </div>
      </div>
      {settings && (
        <Dialog title={t("settings")} onClose={() => setSettings(false)}>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={wrap}
              onChange={(e) => setWrap(e.target.checked)}
            />
            {t("wrapLines")}
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={chart}
              onChange={(e) => setChart(e.target.checked)}
            />
            {t("showChart")}
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={automatic}
              onChange={(e) => setAutomatic(e.target.checked)}
            />
            {t("autoRefresh")} · 5s
          </label>
          <label>
            {t("timezone")}
            <select
              value={zone}
              onChange={(e) => setZone(e.target.value as "local" | "utc")}
            >
              <option value="local">{t("localTime")}</option>
              <option value="utc">{t("utcTime")}</option>
            </select>
          </label>
          <p>{t("preferencesNote")}</p>
        </Dialog>
      )}
      {history && (
        <Dialog title={t("history")} onClose={() => setHistory(false)}>
          <p>{t("savedSession")}</p>
          {sessionHistory.length ? (
            sessionHistory.map((item, index) => (
              <button
                className={styles.historyItem}
                key={`${historyVersion}:${index}`}
                onClick={() => {
                  run(item);
                  setHistory(false);
                }}
              >
                <code>{item}</code>
              </button>
            ))
          ) : (
            <p>{t("noHistory")}</p>
          )}
          <button
            className="text-button"
            onClick={() => {
              clearHistory();
              setHistoryVersion((v) => v + 1);
            }}
          >
            {t("clearHistory")}
          </button>
        </Dialog>
      )}
      {examples && (
        <Dialog title={t("examples")} onClose={() => setExamples(false)}>
          {[
            ["recentErrors", 'level:in("error","fatal","panic")'],
            [
              "serviceCounts",
              "* | stats by (compose_service) count() as count | sort by (count) desc",
            ],
            ["slowRequests", "* | sort by (app.duration_ms desc) | limit 20"],
          ].map(([label, value]) => (
            <button
              key={label}
              className={styles.historyItem}
              onClick={() => {
                run(value);
                setExamples(false);
              }}
            >
              <span>
                {t(label as "recentErrors" | "serviceCounts" | "slowRequests")}
              </span>
              <code>{value}</code>
            </button>
          ))}
        </Dialog>
      )}
    </>
  );
}
