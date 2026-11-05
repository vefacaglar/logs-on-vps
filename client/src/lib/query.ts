export const ranges = {
  "15m": 900,
  "1h": 3600,
  "6h": 21600,
  "12h": 43200,
  "24h": 86400,
  "7d": 604800,
} as const;
export type Range = keyof typeof ranges;
export type Period = { start: string; end: string };
export function periodFor(range: Range): Period {
  const end = new Date();
  return {
    start: new Date(end.getTime() - ranges[range] * 1000).toISOString(),
    end: end.toISOString(),
  };
}
export function validPeriod(p: Period) {
  const start = Date.parse(p.start),
    end = Date.parse(p.end);
  return (
    Number.isFinite(start) &&
    Number.isFinite(end) &&
    end > start &&
    end - start <= 31 * 86400000 &&
    end <= Date.now() + 60000
  );
}
export function filterQuery(query: string, service = "", level = "") {
  const filters = [];
  if (service) filters.push(`compose_service:=${JSON.stringify(service)}`);
  if (level)
    filters.push(
      level === "error"
        ? 'level:in("error","fatal","panic")'
        : `level:=${JSON.stringify(level)}`,
    );
  return filters.length
    ? `(${query.trim() || "*"}) AND (${filters.join(" AND ")})`
    : query.trim() || "*";
}
export function legacyParams(hash: string) {
  const old = new URLSearchParams(hash.replace(/^#\/?\??/, ""));
  const next = new URLSearchParams();
  if (old.has("query")) next.set("q", old.get("query")!);
  const range = old.get("g0.range_input");
  if (range && Object.hasOwn(ranges, range)) next.set("range", range);
  const view = old.get("view");
  if (view && ["group", "table", "json", "live"].includes(view))
    next.set("view", view);
  return next;
}
export function signInDestination(next: string | null, hash = "") {
  const destination =
    next && /^\/(?:explore|overview)?(?:\?|$)/.test(next) ? next : "/";
  return destination.startsWith("/explore") && hash.startsWith("#/")
    ? destination + hash
    : destination;
}
export function addFieldFilter(
  query: string,
  field: string,
  value: string,
  exclude = false,
) {
  let quoted = false,
    escaped = false,
    index = -1;
  for (let i = 0; i < query.length; i++) {
    const char = query[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') quoted = !quoted;
    if (char === "|" && !quoted) {
      index = i;
      break;
    }
  }
  const filter = index < 0 ? query : query.slice(0, index);
  const pipes = index < 0 ? "" : query.slice(index);
  const condition = `${JSON.stringify(field)}:=${JSON.stringify(value)}`;
  return `(${filter.trim() || "*"}) AND ${exclude ? "NOT " : ""}(${condition}) ${pipes}`.trim();
}
