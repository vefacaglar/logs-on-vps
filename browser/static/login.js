const form = document.querySelector("#login-form");
const password = document.querySelector("#password");
const toggle = document.querySelector("#show-password");
toggle.addEventListener("click", () => {
  const show = password.type === "password";
  password.type = show ? "text" : "password";
  toggle.textContent = show ? "gizle" : "göster";
  toggle.setAttribute("aria-pressed", String(show));
});
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = form.querySelector("[type=submit]");
  const error = document.querySelector("#login-error");
  submit.disabled = true;
  submit.textContent = "giriş yapılıyor…";
  error.hidden = true;
  try {
    const response = await fetch("/api/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "logs-ui",
      },
      body: JSON.stringify({
        username: form.username.value,
        password: password.value,
      }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Giriş yapılamadı.");
    window.location.replace("/");
  } catch (reason) {
    error.textContent =
      reason instanceof TypeError
        ? "Bağlantı kurulamadı. Tekrar dene."
        : reason.message;
    error.hidden = false;
    password.value = "";
    password.focus();
  } finally {
    submit.disabled = false;
    submit.textContent = "giriş yap ↗";
  }
});
