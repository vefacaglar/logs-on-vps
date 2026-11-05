import { clearHistory } from "./sessionHistory";
import type { Key } from "./i18n";
export type LogRow = Record<string, unknown>;
export class ApiError extends Error {
  key: Key;
  status: number;
  constructor(key: Key, status = 0, details = "") {
    super(details);
    this.key = key;
    this.status = status;
  }
}
export async function api<T>(
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "logs-ui",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new ApiError("connectionFailed");
  }
  if (!response.ok) {
    if (response.status === 401) clearHistory();
    const key: Key =
      response.status === 401
        ? path === "/api/login"
          ? "invalidCredentials"
          : "sessionExpired"
        : response.status === 429
          ? "rateLimit"
          : response.status === 400
            ? "invalidQuery"
            : "requestFailed";
    throw new ApiError(key, response.status);
  }
  return response.json() as Promise<T>;
}
export async function engine<T>(
  endpoint: string,
  params: Record<string, string | number>,
  signal?: AbortSignal,
): Promise<T> {
  const response = await engineResponse(endpoint, params, signal);
  return response.json() as Promise<T>;
}
export async function engineResponse(
  endpoint: string,
  params: Record<string, string | number>,
  signal?: AbortSignal,
) {
  let response: Response;
  try {
    response = await fetch(`/select/logsql/${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(
        Object.entries(params).map(([key, value]) => [key, String(value)]),
      ),
      signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new ApiError("connectionFailed");
  }
  if (response.status === 401) {
    clearHistory();
    throw new ApiError("sessionExpired", 401);
  }
  if (!response.ok)
    throw new ApiError(
      "queryError",
      response.status,
      (await response.text()).slice(0, 8000),
    );
  return response;
}
export function parseJSONLines(text: string): LogRow[] {
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => {
      const row: unknown = JSON.parse(line);
      if (!row || typeof row !== "object" || Array.isArray(row))
        throw new ApiError("invalidJSON");
      return row as LogRow;
    });
}
export async function* streamJSONLines(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): AsyncGenerator<LogRow> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  const abort = () => {
    void reader.cancel();
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    while (!signal.aborted) {
      const { value, done } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      if (pending.length > 2_000_000) throw new ApiError("invalidJSON");
      const lines = pending.split("\n");
      pending = lines.pop()!;
      for (const line of lines)
        for (const row of parseJSONLines(line)) {
          if (signal.aborted) return;
          yield row;
        }
      if (done) {
        for (const row of parseJSONLines(pending)) yield row;
        break;
      }
    }
  } finally {
    signal.removeEventListener("abort", abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
export function display(value: unknown): string {
  return typeof value === "string"
    ? value
    : value == null
      ? ""
      : JSON.stringify(value);
}
export function fieldsOf(rows: LogRow[]): string[] {
  const keys = new Set(rows.flatMap((row) => Object.keys(row)));
  return [...keys].sort((a, b) => {
    const rank = (key: string) =>
      ["_time", "level", "compose_service", "_msg"].indexOf(key);
    const ar = rank(a),
      br = rank(b);
    return ar < 0 && br < 0
      ? a.localeCompare(b)
      : ar < 0
        ? 1
        : br < 0
          ? -1
          : ar - br;
  });
}
export function quoted(value: string) {
  return JSON.stringify(value);
}
export function download(rows: LogRow[], format: "jsonl" | "csv") {
  const fields = fieldsOf(rows);
  const csv = (value: unknown) => `"${display(value).replaceAll('"', '""')}"`;
  const text =
    format === "jsonl"
      ? rows.map((row) => JSON.stringify(row)).join("\n") + "\n"
      : [
          fields.map(csv).join(","),
          ...rows.map((row) => fields.map((key) => csv(row[key])).join(",")),
        ].join("\r\n");
  const url = URL.createObjectURL(
    new Blob([text], {
      type:
        format === "jsonl" ? "application/x-ndjson" : "text/csv;charset=utf-8",
    }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = `logs-${new Date().toISOString().slice(0, 19).replaceAll(":", "-")}.${format}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
