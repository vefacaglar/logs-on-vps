const $ = (selector) => document.querySelector(selector);
const params = new URLSearchParams(location.search);
const ranges = {
  "15m": 900,
  "1h": 3600,
  "6h": 21600,
  "12h": 43200,
  "24h": 86400,
  "7d": 604800,
};
const state = {
  service: params.get("service") || "",
  level: params.get("level") || "",
  query: params.get("q") || "",
  range: Object.hasOwn(ranges, params.get("range"))
    ? params.get("range")
    : "12h",
  logs: [],
  offset: 0,
  hasMore: false,
  busy: false,
  failed: false,
  generation: 0,
  controller: null,
  services: [],
  start: "",
  end: "",
  refreshed: "",
};
if (!["", "error", "warn", "info", "debug"].includes(state.level))
  state.level = "";
$("#query").value = state.query;
$("#range").value = state.range;
const number = new Intl.NumberFormat("tr-TR");
const time = new Intl.DateTimeFormat("tr-TR", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});
const day = new Intl.DateTimeFormat("tr-TR", {
  day: "2-digit",
  month: "short",
});
const fullTime = new Intl.DateTimeFormat("tr-TR", {
  dateStyle: "medium",
  timeStyle: "medium",
});

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

async function api(path, body, signal) {
  const response = await fetch(path, {
    method: body ? "POST" : "GET",
    signal,
    headers: {
      "Content-Type": "application/json",
      "X-Requested-With": "logs-ui",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (response.status === 401) {
    location.replace("/login");
    throw new Error("Oturum sona erdi.");
  }
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "İstek tamamlanamadı.");
  return result;
}

function requestBody() {
  return {
    query: state.query,
    service: state.service,
    level: state.level,
    start: state.start,
    end: state.end,
    offset: state.offset,
  };
}

function updateURL() {
  const next = new URLSearchParams();
  if (state.service) next.set("service", state.service);
  if (state.level) next.set("level", state.level);
  if (state.query) next.set("q", state.query);
  if (state.range !== "12h") next.set("range", state.range);
  history.replaceState(null, "", next.size ? `/?${next}` : "/");
}

function updateControls() {
  document.querySelectorAll("[data-level]").forEach((button) => {
    const selected = button.dataset.level === state.level;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  $("#page-title").replaceChildren(
    document.createTextNode(state.service || "Tüm loglar"),
    node("span", "accent", "."),
  );
  document.title = `${state.service || "Logs"} · Vefa Çağlar`;
  renderServices();
}

function renderServices() {
  const container = $("#services");
  const make = (name, count) => {
    const button = node(
      "button",
      `service${state.service === name ? " active" : ""}`,
    );
    button.dataset.service = name;
    button.setAttribute("aria-pressed", String(state.service === name));
    button.title = name || "Tüm servisler";
    button.append(
      node("span", "", name || "Tüm servisler"),
      node(
        "span",
        "service-total",
        count === null ? "—" : number.format(count),
      ),
    );
    return button;
  };
  const total = state.services.reduce(
    (sum, service) => sum + Number(service.count || 0),
    0,
  );
  container.replaceChildren(make("", state.services.length ? total : null));
  state.services.forEach((service) => {
    if (service.compose_service)
      container.append(
        make(String(service.compose_service), Number(service.count || 0)),
      );
  });
  if (
    state.service &&
    !state.services.some((service) => service.compose_service === state.service)
  )
    container.append(make(state.service, null));
  $("#service-count").textContent = state.services.length
    ? String(state.services.filter((s) => s.compose_service).length).padStart(
        2,
        "0",
      )
    : "";
}

function status() {
  const count = number.format(state.logs.length);
  let label = `${count} kayıt`;
  if (state.busy)
    label = state.logs.length
      ? `${count} kayıt · yükleniyor…`
      : "Kayıtlar yükleniyor…";
  else if ($("#live").checked) {
    label +=
      state.offset > 100 || $("#logs details[open]")
        ? " · otomatik yenileme beklemede"
        : " · 5 sn aralıkla yenileniyor";
  } else if (state.refreshed) label += ` · ${state.refreshed}`;
  $("#result-status").textContent = label;
  $(".log-table").setAttribute("aria-busy", String(state.busy));
  $("#export").disabled = !state.logs.length;
  $("#load-more").hidden = !state.hasMore;
  $("#load-more").disabled = state.busy;
  $("#load-more").textContent = state.busy
    ? "Yükleniyor…"
    : state.failed
      ? "Tekrar dene ↓"
      : "Daha eski kayıtlar ↓";
  $("#end-status").textContent =
    !state.busy && !state.hasMore && state.logs.length
      ? "Bu aralıktaki tüm kayıtlar gösteriliyor"
      : "";
}

async function copy(text, button) {
  const original = button.textContent;
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = "Kopyalandı";
  } catch {
    button.textContent = "Kopyalanamadı";
  }
  setTimeout(() => {
    button.textContent = original;
  }, 1800);
}

function renderLog(log) {
  const details = node("details", "log-row");
  const summary = node("summary");
  const date = new Date(log._time);
  const validDate = !Number.isNaN(date.getTime());
  const timestamp = node(
    "time",
    "log-time",
    validDate ? time.format(date) : "—",
  );
  if (validDate) {
    timestamp.dateTime = log._time;
    timestamp.title = log._time;
    timestamp.append(node("span", "log-date", day.format(date)));
  }
  const level = String(log.level || "—").toLowerCase();
  const levelClass = [
    "error",
    "fatal",
    "panic",
    "warn",
    "info",
    "debug",
    "trace",
  ].includes(level)
    ? level
    : "";
  const service = String(log.compose_service || log.container_name || "—");
  const message =
    typeof log._msg === "string" ? log._msg : JSON.stringify(log._msg ?? "");
  summary.append(
    timestamp,
    node("span", `log-level ${levelClass}`, level),
    node("span", "log-service", service),
    node("span", "log-message", message || "(boş mesaj)"),
  );
  details.append(summary);
  // Field DOM is created only for expanded rows, keeping long histories cheap.
  let created = false;
  details.addEventListener("toggle", () => {
    if (details.open && !created) {
      created = true;
      const panel = node("div", "log-details");
      const tools = node("div", "detail-tools");
      const copyMessage = node("button", "text-button", "Mesajı kopyala ↗");
      copyMessage.addEventListener("click", () => copy(message, copyMessage));
      const copyJSON = node("button", "text-button", "JSON kopyala ↗");
      copyJSON.addEventListener("click", () =>
        copy(JSON.stringify(log, null, 2), copyJSON),
      );
      tools.append(copyMessage, copyJSON);
      panel.append(tools, node("pre", "detail-message", message));
      const fields = node("dl", "field-list");
      Object.entries(log)
        .filter(([key]) => key !== "_msg")
        .sort(([a], [b]) => a.localeCompare(b))
        .forEach(([key, value]) => {
          fields.append(
            node("dt", "", key),
            node(
              "dd",
              "",
              typeof value === "string" ? value : JSON.stringify(value),
            ),
          );
        });
      panel.append(fields);
      details.append(panel);
    }
    status();
  });
  return details;
}

async function load(reset = false, automatic = false) {
  if (!reset && (state.busy || !state.hasMore)) return;
  if (reset) {
    state.controller?.abort();
    state.controller = new AbortController();
    state.generation++;
    state.offset = 0;
    state.hasMore = false;
    const end = new Date();
    state.end = end.toISOString();
    state.start = new Date(
      end.getTime() - ranges[state.range] * 1000,
    ).toISOString();
    if (!automatic) {
      state.logs = [];
      $("#logs").replaceChildren();
    }
  }
  const generation = state.generation;
  const signal = state.controller.signal;
  state.busy = true;
  state.failed = false;
  $("#empty").hidden = true;
  $("#query-error").hidden = true;
  status();
  // Freeze this interval while browsing older pages. Refresh creates a new interval.
  const body = requestBody();
  if (reset) {
    $("#snapshot-time").textContent =
      `${fullTime.format(new Date(state.start))} — ${fullTime.format(new Date(state.end))}`;
    api("/api/services", body, signal)
      .then((result) => {
        if (generation !== state.generation) return;
        state.services = result.services.sort(
          (a, b) =>
            Number(b.count) - Number(a.count) ||
            String(a.compose_service || "").localeCompare(
              String(b.compose_service || ""),
            ),
        );
        $("#service-status").textContent = "";
        renderServices();
      })
      .catch((error) => {
        if (error.name !== "AbortError" && generation === state.generation)
          $("#service-status").textContent = "Servis listesi alınamadı.";
      });
  }
  try {
    const result = await api("/api/logs", body, signal);
    if (generation !== state.generation) return;
    if (reset) {
      state.logs = [];
      $("#logs").replaceChildren();
    }
    state.logs.push(...result.logs);
    const fragment = document.createDocumentFragment();
    result.logs.forEach((log) => fragment.append(renderLog(log)));
    $("#logs").append(fragment);
    state.offset = result.nextOffset;
    state.hasMore = result.hasMore;
    state.refreshed = time.format(new Date());
    $("#empty").hidden = !!state.logs.length;
  } catch (error) {
    if (error.name === "AbortError" || generation !== state.generation) return;
    state.failed = true;
    $("#query-error").textContent =
      error instanceof TypeError
        ? "Bağlantı kurulamadı. Tekrar dene."
        : error.message;
    $("#query-error").hidden = false;
  } finally {
    if (generation === state.generation) {
      state.busy = false;
      status();
    }
  }
}

$("#query-form").addEventListener("submit", (event) => {
  event.preventDefault();
  state.query = $("#query").value.trim();
  updateURL();
  load(true);
});
$("#services").addEventListener("click", (event) => {
  const button = event.target.closest("[data-service]");
  if (!button) return;
  state.service = button.dataset.service;
  updateControls();
  updateURL();
  load(true);
});
$(".level-filters").addEventListener("click", (event) => {
  const button = event.target.closest("[data-level]");
  if (!button) return;
  state.level = button.dataset.level;
  updateControls();
  updateURL();
  load(true);
});
$("#range").addEventListener("change", () => {
  state.range = $("#range").value;
  updateURL();
  load(true);
});
$("#live").addEventListener("change", status);
$("#refresh").addEventListener("click", () => load(true));
$("#load-more").addEventListener("click", () => load());
$("#clear-filters").addEventListener("click", () => {
  state.service = "";
  state.level = "";
  state.query = "";
  $("#query").value = "";
  updateControls();
  updateURL();
  load(true);
});
$("#logout").addEventListener("click", async () => {
  try {
    await api("/api/logout", {});
    location.replace("/login");
  } catch (error) {
    $("#query-error").textContent = error.message;
    $("#query-error").hidden = false;
  }
});
$("#export").addEventListener("click", () => {
  const blob = new Blob(
    [state.logs.map((log) => JSON.stringify(log)).join("\n") + "\n"],
    { type: "application/x-ndjson" },
  );
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `logs-${state.end.slice(0, 19).replaceAll(":", "-")}.jsonl`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
document.addEventListener("keydown", (event) => {
  if (
    event.key === "/" &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.altKey &&
    !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName)
  ) {
    event.preventDefault();
    $("#query").focus();
  }
});
// Scroll-driven paging plus an explicit button for older records.
window.addEventListener(
  "scroll",
  () => {
    if (
      !state.failed &&
      !state.busy &&
      state.hasMore &&
      $("#load-sentinel").getBoundingClientRect().top < innerHeight + 180
    )
      load();
  },
  { passive: true },
);
setInterval(() => {
  if (
    $("#live").checked &&
    !document.hidden &&
    !state.busy &&
    !state.failed &&
    state.offset <= 100 &&
    !$("#logs details[open]") &&
    !["INPUT", "SELECT"].includes(document.activeElement.tagName)
  )
    load(true, true);
}, 5000);
api("/api/session")
  .then((session) => {
    $("#username").textContent = session.username;
  })
  .catch(() => {});
updateControls();
load(true);
