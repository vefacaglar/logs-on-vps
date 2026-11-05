import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { usePageTitle, usePreferences } from "../../app/Preferences";
import { ErrorMessage, PageHeading } from "../../app/Shell";
import { TimeRange } from "../../components/TimeRange";
import { Histogram } from "../../components/Histogram";
import { CopyButton } from "../../components/LogViews";
import { engine } from "../../lib/api";
import { addFieldFilter, periodFor, ranges, type Range } from "../../lib/query";
import styles from "./Overview.module.css";
type Values = { values: { value: string; hits: number }[] };
export default function Overview() {
  usePageTitle("overview");
  const { t, locale } = usePreferences();
  const [params, setParams] = useSearchParams();
  const query = params.get("q") || "*";
  const range = (
    Object.hasOwn(ranges, params.get("range") || "")
      ? params.get("range")
      : "12h"
  ) as Range;
  const [draft, setDraft] = useState(query),
    [period, setPeriod] = useState(() => periodFor(range)),
    [field, setField] = useState(params.get("field") || ""),
    [filter, setFilter] = useState(""),
    [valueFilter, setValueFilter] = useState("");
  useEffect(() => setPeriod(periodFor(range)), [range]);
  const fields = useQuery({
    queryKey: ["overviewFields", query, period],
    queryFn: ({ signal }) =>
      engine<Values>(
        "field_names",
        { query, ...period, ignore_pipes: 1, timeout: "20s" },
        signal,
      ),
    retry: false,
  });
  const values = useQuery({
    queryKey: ["overviewValues", query, period, field, valueFilter],
    queryFn: ({ signal }) =>
      engine<Values>(
        "field_values",
        {
          query,
          ...period,
          field,
          filter: valueFilter,
          limit: 100,
          ignore_pipes: 1,
          timeout: "20s",
        },
        signal,
      ),
    enabled: !!field,
    retry: false,
  });
  const number = (value: number) => new Intl.NumberFormat(locale).format(value);
  const setRange = (range: Range) => {
    const next = new URLSearchParams(params);
    next.set("range", range);
    setParams(next, { replace: true });
  };
  return (
    <>
      <PageHeading title={t("overview")} eyebrow={t("overviewIntro")}>
        <TimeRange range={range} period={period} onRange={setRange} />
        <button className="ghost" onClick={() => setPeriod(periodFor(range))}>
          {t("refresh")} ↻
        </button>
      </PageHeading>
      <form
        className={styles.search}
        onSubmit={(e) => {
          e.preventDefault();
          const next = new URLSearchParams(params);
          next.set("q", draft.trim() || "*");
          setParams(next, { replace: true });
        }}
      >
        <input
          aria-label={t("queryFilter")}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          spellCheck={false}
        />
        <button className="primary">{t("search")} ↵</button>
        <Link
          className="ghost"
          to={`/explore?q=${encodeURIComponent(query)}&range=${range}`}
        >
          {t("openQuery")} ↗
        </Link>
      </form>
      <ErrorMessage error={fields.error} />
      <Histogram query={query} period={period} />
      <div className={styles.panels}>
        <section>
          <div className={styles.heading}>
            <h2>{t("fields")}</h2>
            <span>{fields.data?.values.length || 0}</span>
          </div>
          <input
            aria-label={t("searchFields")}
            placeholder={t("searchFields")}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <div className={styles.list}>
            {fields.data?.values
              .filter((row) =>
                row.value
                  .toLocaleLowerCase()
                  .includes(filter.toLocaleLowerCase()),
              )
              .map((row) => (
                <button
                  key={row.value}
                  aria-pressed={field === row.value}
                  onClick={() => {
                    setField(row.value);
                    setValueFilter("");
                    const next = new URLSearchParams(params);
                    next.set("field", row.value);
                    setParams(next, { replace: true });
                  }}
                >
                  <code>{row.value}</code>
                  <span>{number(row.hits)}</span>
                </button>
              ))}
            {fields.isPending && <p>{t("loading")}</p>}
          </div>
        </section>
        <section>
          <div className={styles.heading}>
            <h2>
              {t("values")}
              {field && (
                <>
                  : <code>{field}</code>
                </>
              )}
            </h2>
            <span>{values.data?.values.length || 0}</span>
          </div>
          {field ? (
            <>
              <input
                aria-label={t("values")}
                placeholder={t("search")}
                value={valueFilter}
                onChange={(e) => setValueFilter(e.target.value)}
              />
              <ErrorMessage error={values.error} />
              {values.isFetching && (
                <p className={styles.status}>{t("loading")}</p>
              )}
              <div className={styles.values}>
                {values.data?.values.map((row) => (
                  <div key={row.value}>
                    <code>{row.value || "∅"}</code>
                    <span>{number(row.hits)}</span>
                    <CopyButton value={row.value} />
                    <Link
                      to={`/explore?q=${encodeURIComponent(addFieldFilter(query, field, row.value))}&range=${range}`}
                      title={t("include")}
                      aria-label={`${t("include")}: ${row.value}`}
                    >
                      ↗
                    </Link>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="empty">
              <p>{t("chooseField")}</p>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
