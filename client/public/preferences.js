// Apply visual preferences before CSS or React paints the page.
(() => {
  let theme = matchMedia("(prefers-color-scheme: light)").matches
    ? "light"
    : "dark";
  let language = navigator.language.toLowerCase().startsWith("tr")
    ? "tr"
    : "en";
  try {
    const savedTheme = localStorage.getItem("logs.theme");
    const savedLanguage = localStorage.getItem("logs.language");
    if (savedTheme === "light" || savedTheme === "dark") theme = savedTheme;
    if (savedLanguage === "tr" || savedLanguage === "en")
      language = savedLanguage;
  } catch {
    /* Preferences still work in memory when storage is unavailable. */
  }
  document.documentElement.dataset.theme = theme;
  document.documentElement.lang = language;
})();
