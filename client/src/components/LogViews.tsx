import { memo, useEffect, useMemo, useState } from "react";
import { display, fieldsOf, type LogRow } from "../lib/api";
import { usePreferences } from "../app/Preferences";
import { Dialog } from "./Dialog";
import styles from "./LogViews.module.css";
export function CopyButton({
  value,
  label,
}: {
  value: string;
  label?: string;
}) {
  const { t } = usePreferences();
  const [result, setResult] = useState<"copied" | "copyFailed" | null>(null);
  return (
    <button
      className="text-button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setResult("copied");
        } catch {
          setResult("copyFailed");
        }
        setTimeout(() => setResult(null), 1600);
      }}
    >
      {result ? t(result) : label || t("copy")}
    </button>
  );
}
type Props = {
  rows: LogRow[];
  groupBy?: string;
  wrap?: boolean;
  onFilter?: (key: string, value: string, exclude?: boolean) => void;
};
export const LogEntry = memo(function LogEntry({
  row,
  expansion = 0,
  onFilter,
}: {
  row: LogRow;
  expansion?: number;
  onFilter?: Props["onFilter"];
}) {
  const { t, locale, zone } = usePreferences();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (expansion !== 0) setOpen(expansion % 2 === 1);
  }, [expansion]);
  const date = new Date(display(row._time));
  const valid = Number.isFinite(+date);
  const format = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(locale, {
      ...options,
      timeZone: zone === "utc" ? "UTC" : undefined,
    }).format(date);
  const level = display(row.level) || "—";
  const machineLevel = level.toLowerCase();
  const severity = [
    "error",
    "fatal",
    "panic",
    "warn",
    "info",
    "debug",
    "trace",
  ].includes(machineLevel)
    ? `badge-${machineLevel}`
    : "";
  return (
    <details
      className={styles.entry}
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>
        <time
          className={styles.time}
          dateTime={valid ? date.toISOString() : undefined}
          title={display(row._time)}
        >
          {valid
            ? format({ hour: "2-digit", minute: "2-digit", second: "2-digit" })
            : "—"}
          {valid && <span>{format({ day: "2-digit", month: "short" })}</span>}
        </time>
        <span className={`${styles.level} ${severity}`}>{level}</span>
        <span
          className={styles.service}
          title={display(row.compose_service || row.container_name)}
        >
          {display(row.compose_service || row.container_name) || "—"}
        </span>
        <span className={styles.message}>
          {display(row._msg) || t("emptyMessage")}
        </span>
      </summary>
      {open && (
        <div className={styles.details}>
          <div className={styles.tools}>
            <CopyButton value={display(row._msg)} label={t("copyMessage")} />
            <CopyButton
              value={JSON.stringify(row, null, 2)}
              label={t("copyJSON")}
            />
          </div>
          <pre className={styles.fullMessage}>{display(row._msg)}</pre>
          <dl className={styles.fields}>
            {Object.entries(row)
              .filter(([key]) => key !== "_msg")
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([key, value]) => (
                <div key={key}>
                  <dt>{key}</dt>
                  <dd>{display(value)}</dd>
                  {onFilter && (
                    <span className={styles.fieldActions}>
                      <button
                        className="text-button"
                        title={t("include")}
                        aria-label={`${t("include")}: ${key}`}
                        onClick={() => onFilter(key, display(value))}
                      >
                        +
                      </button>
                      <button
                        className="text-button"
                        title={t("exclude")}
                        aria-label={`${t("exclude")}: ${key}`}
                        onClick={() => onFilter(key, display(value), true)}
                      >
                        −
                      </button>
                    </span>
                  )}
                </div>
              ))}
          </dl>
        </div>
      )}
    </details>
  );
});
export function GroupView({
  rows,
  groupBy = "",
  wrap = false,
  onFilter,
}: Props) {
  const { t, locale } = usePreferences();
  const [expansion, setExpansion] = useState(0);
  const groups = useMemo(() => {
    const map = new Map<string, LogRow[]>();
    for (const row of rows) {
      const key = groupBy ? display(row[groupBy]) : "";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(row);
    }
    return [...map];
  }, [rows, groupBy]);
  return (
    <div className={wrap ? styles.wrap : undefined}>
      <div className={styles.viewTools}>
        <button
          className="text-button"
          onClick={() => setExpansion((v) => v + 1)}
        >
          {t(expansion % 2 === 1 ? "collapseAll" : "expandAll")}
        </button>
        <span className="muted">
          {new Intl.NumberFormat(locale).format(rows.length)} {t("rows")}
        </span>
      </div>
      <div className={styles.columns} aria-hidden="true">
        <span>{t("timestamp")}</span>
        <span>{t("level")}</span>
        <span>{t("service")}</span>
        <span>{t("message")}</span>
      </div>
      {groups.map(([key, items]) => (
        <section key={key}>
          {groupBy && (
            <h3 className={styles.groupTitle}>
              {groupBy}: <code>{key || "∅"}</code>
              <span>{new Intl.NumberFormat(locale).format(items.length)}</span>
            </h3>
          )}
          {items.map((row, index) => (
            <LogEntry
              key={`${index}:${display(row._time)}:${display(row._stream_id)}`}
              row={row}
              expansion={expansion}
              onFilter={onFilter}
            />
          ))}
        </section>
      ))}
    </div>
  );
}
export function TableView({ rows, wrap = false, onFilter }: Props) {
  const { t } = usePreferences();
  const fields = useMemo(() => fieldsOf(rows), [rows]);
  const [selected, setSelected] = useState<string[]>([]),
    [settings, setSettings] = useState(false);
  const visible = selected.length
    ? selected.filter((key) => fields.includes(key))
    : fields.slice(0, 8);
  return (
    <>
      <div className={styles.viewTools}>
        <button className="text-button" onClick={() => setSettings(true)}>
          {t("selectedFields")} ↗
        </button>
      </div>
      <div className={styles.tableScroll}>
        <table className={wrap ? styles.tableWrap : undefined}>
          <thead>
            <tr>
              {visible.map((key) => (
                <th key={key}>{key}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index}>
                {visible.map((key) => (
                  <td key={key}>
                    {onFilter ? (
                      <button
                        className={styles.cell}
                        onClick={() => onFilter(key, display(row[key]))}
                        title={t("include")}
                      >
                        {display(row[key])}
                      </button>
                    ) : (
                      display(row[key])
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {settings && (
        <Dialog title={t("selectedFields")} onClose={() => setSettings(false)}>
          <button className="text-button" onClick={() => setSelected(fields)}>
            {t("allFields")}
          </button>
          <fieldset>
            {fields.map((key) => (
              <label key={key}>
                <input
                  type="checkbox"
                  checked={visible.includes(key)}
                  onChange={(e) =>
                    setSelected(
                      e.target.checked
                        ? [...visible, key]
                        : visible.length > 1
                          ? visible.filter((k) => k !== key)
                          : visible,
                    )
                  }
                />
                <code>{key}</code>
              </label>
            ))}
          </fieldset>
        </Dialog>
      )}
    </>
  );
}
export function JSONView({ rows, wrap = false }: Props) {
  const { t } = usePreferences();
  const text = useMemo(
    () => rows.map((row) => JSON.stringify(row, null, 2)).join("\n"),
    [rows],
  );
  return (
    <>
      <div className={styles.viewTools}>
        <CopyButton value={text} label={t("copyJSON")} />
      </div>
      <pre className={`${styles.json} ${wrap ? styles.jsonWrap : ""}`}>
        {text}
      </pre>
    </>
  );
}
