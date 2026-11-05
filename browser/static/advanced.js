document
  .querySelector("#logs-advanced-logout")
  ?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const response = await fetch("/api/logout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "logs-ui",
        },
        body: "{}",
      });
      if (!response.ok && response.status !== 401)
        throw new Error("Çıkış yapılamadı. Tekrar dene.");
      location.replace("/login");
    } catch {
      button.textContent = "Tekrar dene";
      button.disabled = false;
    }
  });

// The native UI updates the tab title after executing queries and changing views.
// Keep that useful context while using the same identity as the main console.
const title = document.querySelector("title");
const updateTitle = () => {
  if (document.title.includes("Vefa Çağlar")) return;
  const context = document.title
    .replace(/(?:UI|VMUI) for VictoriaLogs/g, "Gelişmiş sorgu")
    .replace(/VictoriaLogs/g, "Logs");
  document.title = `${context || "Gelişmiş sorgu"} · Logs · Vefa Çağlar`;
};
if (title)
  new MutationObserver(updateTitle).observe(title, {
    childList: true,
    characterData: true,
    subtree: true,
  });
updateTitle();
