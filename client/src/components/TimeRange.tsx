import { useState } from "react";
import { usePreferences } from "../app/Preferences";
import { ranges, validPeriod, type Range, type Period } from "../lib/query";
import { Dialog } from "./Dialog";
import type { Key } from "../lib/i18n";
import styles from "./TimeRange.module.css";
export const rangeKeys: Record<Range, Key> = {
  "15m": "last15m",
  "1h": "last1h",
  "6h": "last6h",
  "12h": "last12h",
  "24h": "last24h",
  "7d": "last7d",
};
const toInput = (value: string, zone: "local" | "utc") => {
  const d = new Date(value);
  if (zone === "utc") return d.toISOString().slice(0, 16);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
};
export function TimeRange({
  range,
  period,
  onRange,
  onPeriod,
}: {
  range: Range | "custom";
  period: Period;
  onRange: (range: Range) => void;
  onPeriod?: (p: Period) => void;
}) {
  const { t, zone } = usePreferences();
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState(""),
    [end, setEnd] = useState(""),
    [invalid, setInvalid] = useState(false);
  return (
    <>
      <label className={styles.control}>
        <span className="sr-only">{t("range")}</span>
        <select
          aria-label={t("range")}
          value={range}
          onChange={(e) => {
            if (e.target.value === "custom") {
              setStart(toInput(period.start, zone));
              setEnd(toInput(period.end, zone));
              setInvalid(false);
              setOpen(true);
            } else onRange(e.target.value as Range);
          }}
        >
          {Object.keys(ranges).map((key) => (
            <option key={key} value={key}>
              {t(rangeKeys[key as Range])}
            </option>
          ))}
          {onPeriod && <option value="custom">{t("custom")}</option>}
        </select>
      </label>
      {open && (
        <Dialog
          title={`${t("custom")} · ${t(zone === "utc" ? "utcTime" : "localTime")}`}
          onClose={() => setOpen(false)}
        >
          <label className={styles.date}>
            {t("from")}
            <input
              aria-label={t("from")}
              type="datetime-local"
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </label>
          <label className={styles.date}>
            {t("to")}
            <input
              aria-label={t("to")}
              type="datetime-local"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
          </label>
          {invalid && <p role="alert">{t("invalidRange")}</p>}
          <button
            className="primary"
            onClick={() => {
              const a = new Date(start + (zone === "utc" ? "Z" : "")),
                b = new Date(end + (zone === "utc" ? "Z" : ""));
              if (Number.isNaN(+a) || Number.isNaN(+b)) {
                setInvalid(true);
                return;
              }
              const p = { start: a.toISOString(), end: b.toISOString() };
              if (!validPeriod(p)) {
                setInvalid(true);
                return;
              }
              onPeriod?.(p);
              setOpen(false);
            }}
          >
            {t("apply")}
          </button>
        </Dialog>
      )}
    </>
  );
}
