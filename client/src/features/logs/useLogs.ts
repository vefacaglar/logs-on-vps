import { useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  engineResponse,
  parseJSONLines,
  type LogRow,
} from "../../lib/api";
import type { Period } from "../../lib/query";
export type LogOptions = {
  mode: "console" | "engine";
  query: string;
  period: Period;
  service?: string;
  level?: string;
  limit?: number;
};
export function useLogs(options: LogOptions) {
  const [rows, setRows] = useState<LogRow[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(),
    [hasMore, setHasMore] = useState(false),
    [duration, setDuration] = useState(0),
    [reload, setReload] = useState(0);
  const controller = useRef<AbortController>(null),
    generation = useRef(0),
    offset = useRef(0),
    loading = useRef(false);
  const key = JSON.stringify(options);
  const load = useCallback(
    async (reset: boolean) => {
      if (!reset && loading.current) return;
      if (reset) {
        controller.current?.abort();
        controller.current = new AbortController();
        generation.current++;
        offset.current = 0;
        setRows([]);
        setHasMore(false);
      }
      const current = generation.current;
      const signal = controller.current!.signal;
      const started = performance.now();
      loading.current = true;
      setBusy(true);
      setError(undefined);
      try {
        let batch: LogRow[], more: boolean;
        if (options.mode === "console") {
          const result = await api<{
            logs: LogRow[];
            hasMore: boolean;
            nextOffset: number;
          }>(
            "/api/logs",
            {
              query: options.query,
              service: options.service || "",
              level: options.level || "",
              ...options.period,
              offset: offset.current,
            },
            signal,
          );
          batch = result.logs;
          more = result.hasMore;
        } else {
          const limit = options.limit || 100;
          const response = await engineResponse(
            "query",
            {
              query: options.query || "*",
              ...options.period,
              limit: limit + 1,
              offset: offset.current,
              timeout: "20s",
            },
            signal,
          );
          batch = parseJSONLines(await response.text());
          more = batch.length > limit;
          batch = batch.slice(0, limit);
        }
        if (current !== generation.current || signal.aborted) return;
        offset.current += batch.length;
        setRows((previous) => (reset ? batch : [...previous, ...batch]));
        setHasMore(more);
        setDuration(Math.round(performance.now() - started));
      } catch (e) {
        if (current === generation.current && !signal.aborted) setError(e);
      } finally {
        if (current === generation.current) {
          loading.current = false;
          setBusy(false);
        }
      }
    },
    [key],
  );
  useEffect(() => {
    void load(true);
    return () => controller.current?.abort();
  }, [load, reload]);
  return {
    rows,
    busy,
    error,
    hasMore,
    duration,
    loadMore: () => load(false),
    refresh: () => setReload((v) => v + 1),
    stop: () => {
      controller.current?.abort();
      loading.current = false;
      setBusy(false);
    },
  };
}
