import { useMemo, useState, type PointerEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { usePreferences } from "../app/Preferences";
import { engine } from "../lib/api";
import type { Period } from "../lib/query";
import styles from "./Histogram.module.css";
type Hit = {
  fields: Record<string, string>;
  timestamps: string[];
  values: number[];
  total: number;
};
function stepFor(period: Period) {
  const target =
    (Date.parse(period.end) - Date.parse(period.start)) / 1000 / 80;
  return (
    [1, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600, 10800, 21600, 86400].find(
      (step) => step >= target,
    ) || 86400
  );
}
export function Histogram({
  query,
  period,
  groupBy = "",
  onPeriod,
}: {
  query: string;
  period: Period;
  groupBy?: string;
  onPeriod?: (p: Period) => void;
}) {
  const { t, locale, zone } = usePreferences();
  const [selection, setSelection] = useState<[number, number] | null>(null);
  const step = stepFor(period);
  const hits = useQuery({
    queryKey: ["hits", query, period.start, period.end, groupBy],
    queryFn: ({ signal }) =>
      engine<{ hits: Hit[] }>(
        "hits",
        {
          query: query || "*",
          ...period,
          step: `${step}s`,
          ignore_pipes: 1,
          fields_limit: 5,
          ...(groupBy ? { field: groupBy } : {}),
          timeout: "20s",
        },
        signal,
      ),
    retry: false,
  });
  const series = hits.data?.hits || [];
  const { timestamps, values, max, total } = useMemo(() => {
    const timestamps = [...new Set(series.flatMap((s) => s.timestamps))].sort();
    const values = series.map((s) => {
      const map = new Map(
        s.timestamps.map((time, index) => [time, s.values[index] || 0]),
      );
      return timestamps.map((time) => map.get(time) || 0);
    });
    const sums = timestamps.map((_, i) =>
      values.reduce((sum, v) => sum + v[i], 0),
    );
    return {
      timestamps,
      values,
      max: Math.max(1, ...sums),
      total: series.reduce((sum, s) => sum + s.total, 0),
    };
  }, [series]);
  const start = Date.parse(period.start),
    end = Date.parse(period.end);
  const x = (time: number) => 48 + ((time - start) / (end - start)) * 940;
  const y = (value: number) => 174 - (value / max) * 150;
  const numbers = new Intl.NumberFormat(locale, {
    notation: "compact",
    maximumFractionDigits: 1,
  });
  const format = (time: number) =>
    new Intl.DateTimeFormat(locale, {
      hour: "2-digit",
      minute: "2-digit",
      ...(end - start > 86400000 ? { day: "2-digit", month: "short" } : {}),
      timeZone: zone === "utc" ? "UTC" : undefined,
    }).format(time);
  const indexAt = (e: PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    return Math.min(
      end,
      Math.max(
        start,
        start +
          ((((e.clientX - box.left) / box.width) * 1024 - 48) / 940) *
            (end - start),
      ),
    );
  };
  return (
    <section className={styles.chart} aria-label={t("chart")}>
      <div className={styles.heading}>
        <h2>{t("chart")}</h2>
        <span>
          {t("total")}: {numbers.format(total)}
        </span>
        <span>
          {t("interval")}:{" "}
          {step < 60
            ? `${step}s`
            : step < 3600
              ? `${step / 60}m`
              : `${step / 3600}h`}
        </span>
        {hits.isFetching && <span role="status">{t("loading")}</span>}
      </div>
      {hits.error ? (
        <p className={styles.error}>{t("chartUnavailable")}</p>
      ) : (
        <svg
          viewBox="0 0 1024 216"
          role="img"
          aria-label={`${t("chart")} — ${t("total")}: ${numbers.format(total)}. ${t("chartHelp")}`}
          onPointerDown={(e) => {
            if (!onPeriod) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            setSelection([indexAt(e), indexAt(e)]);
          }}
          onPointerMove={(e) => {
            if (selection) setSelection([selection[0], indexAt(e)]);
          }}
          onPointerUp={(e) => {
            if (!selection) return;
            const from = Math.min(...selection),
              to = Math.max(...selection);
            setSelection(null);
            e.currentTarget.releasePointerCapture(e.pointerId);
            if (to - from > step * 1000)
              onPeriod?.({
                start: new Date(from).toISOString(),
                end: new Date(to).toISOString(),
              });
          }}
          onPointerCancel={() => setSelection(null)}
        >
          {[0, 0.5, 1].map((part) => (
            <g key={part}>
              <line
                x1="48"
                x2="988"
                y1={y(max * part)}
                y2={y(max * part)}
                className={styles.grid}
              />
              <text x="36" y={y(max * part) + 4} textAnchor="end">
                {numbers.format(max * part)}
              </text>
            </g>
          ))}
          {timestamps.map((time, i) => {
            let bottom = 0;
            return values.map((seriesValues, s) => {
              const v = seriesValues[i];
              const top = bottom + v;
              const result = (
                <rect
                  key={`${i}:${s}`}
                  className={styles[`series${s % 5}`]}
                  x={x(Math.max(start, Date.parse(time)))}
                  y={y(top)}
                  width={Math.max(
                    1,
                    Math.min(x(Date.parse(time) + step * 1000), 988) -
                      x(Math.max(start, Date.parse(time))) -
                      1,
                  )}
                  height={Math.max(0, y(bottom) - y(top))}
                >
                  <title>
                    {format(Date.parse(time))} ·{" "}
                    {Object.values(series[s].fields).join(", ") || t("all")} ·{" "}
                    {v}
                  </title>
                </rect>
              );
              bottom = top;
              return result;
            });
          })}
          {[0, 0.25, 0.5, 0.75, 1].map((part) => (
            <text
              key={part}
              x={48 + 940 * part}
              y="203"
              textAnchor={part === 0 ? "start" : part === 1 ? "end" : "middle"}
            >
              {format(start + (end - start) * part)}
            </text>
          ))}
          {selection && (
            <rect
              x={x(Math.min(...selection))}
              y="20"
              width={Math.max(
                0,
                x(Math.max(...selection)) - x(Math.min(...selection)),
              )}
              height="154"
              className={styles.selection}
            />
          )}
        </svg>
      )}
      <div className={styles.legend}>
        {groupBy &&
          series.map((s, i) => (
            <span key={i}>
              <i className={styles[`series${i % 5}`]} />
              {Object.values(s.fields).join(", ") || "∅"}
            </span>
          ))}
        {onPeriod && <small>{t("chartHelp")}</small>}
      </div>
    </section>
  );
}
