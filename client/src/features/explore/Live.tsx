import { useEffect, useRef, useState } from "react";
import {
  download,
  engineResponse,
  streamJSONLines,
  type LogRow,
} from "../../lib/api";
import { usePreferences } from "../../app/Preferences";
import { ErrorMessage } from "../../app/Shell";
import { GroupView } from "../../components/LogViews";
import styles from "./Explore.module.css";
export function Live({ query, wrap }: { query: string; wrap: boolean }) {
  const { t } = usePreferences();
  const [running, setRunning] = useState(false),
    [rows, setRows] = useState<LogRow[]>([]),
    [error, setError] = useState<unknown>();
  const controller = useRef<AbortController>(null);
  useEffect(() => {
    setRunning(false);
    setRows([]);
    setError(undefined);
    const previous = controller.current;
    controller.current = null;
    previous?.abort();
    return () => {
      controller.current?.abort();
      controller.current = null;
    };
  }, [query]);
  async function start() {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setRunning(true);
    setError(undefined);
    try {
      let timer: ReturnType<typeof setInterval> | undefined;
      try {
        const response = await engineResponse(
          "tail",
          { query: query || "*", start_offset: "10s", refresh_interval: "2s" },
          current.signal,
        );
        if (!response.body) throw new Error("No stream");
        let batch: LogRow[] = [];
        const flush = () => {
          if (!batch.length || current.signal.aborted) return;
          const next = batch;
          batch = [];
          setRows((previous) =>
            [...next.reverse(), ...previous].slice(0, 1000),
          );
        };
        timer = setInterval(flush, 200);
        for await (const row of streamJSONLines(
          response.body,
          current.signal,
        )) {
          batch.push(row);
          if (batch.length >= 50) flush();
        }
        flush();
      } finally {
        clearInterval(timer);
      }
    } catch (e) {
      if (!current.signal.aborted) setError(e);
    } finally {
      if (controller.current === current) setRunning(false);
    }
  }
  return (
    <section>
      <div className={styles.liveTools}>
        <p>{t(running ? "liveWaiting" : "liveIntro")}</p>
        <button
          className={running ? "ghost" : "primary"}
          onClick={() => {
            if (running) {
              controller.current?.abort();
              setRunning(false);
            } else void start();
          }}
        >
          {t(running ? "stop" : "startLive")}
        </button>
      </div>
      <ErrorMessage error={error} />
      <div className={styles.resultActions}>
        <button
          className="text-button"
          disabled={!rows.length}
          onClick={() => download(rows, "jsonl")}
        >
          {t("downloadJSONL")} ↓
        </button>
        <button
          className="text-button"
          disabled={!rows.length}
          onClick={() => download(rows, "csv")}
        >
          {t("downloadCSV")} ↓
        </button>
      </div>
      {!running && !error && rows.length > 0 && (
        <p className="muted">{t("liveStopped")}</p>
      )}
      <GroupView rows={rows} wrap={wrap} />
      <p className={styles.hint}>{t("liveBuffer", { count: 1000 })}</p>
    </section>
  );
}
