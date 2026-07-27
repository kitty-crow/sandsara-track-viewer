type Theme = "light" | "dark";

const storageKey = "sandsara.theme";
const media = window.matchMedia("(prefers-color-scheme: dark)");
const button = document.querySelector<HTMLButtonElement>("[data-theme-toggle]");
const themeColour = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');

function storedTheme(): Theme | undefined {
  const value = localStorage.getItem(storageKey);
  return value === "light" || value === "dark" ? value : undefined;
}

function preferredTheme(): Theme {
  return media.matches ? "dark" : "light";
}

function activeTheme(): Theme {
  return storedTheme() ?? preferredTheme();
}

function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;

  if (themeColour !== null) {
    themeColour.content = theme === "dark" ? "#18211d" : "#f3eee4";
  }

  if (button !== null) {
    const dark = theme === "dark";
    button.textContent = dark ? "🌙" : "☀️";
    button.setAttribute("aria-label", dark ? "Dark mode enabled. Switch to light mode" : "Light mode enabled. Switch to dark mode");
    button.setAttribute("title", dark ? "Dark mode enabled" : "Light mode enabled");
    button.setAttribute("aria-pressed", String(dark));
  }
}

button?.addEventListener("click", () => {
  const next: Theme = activeTheme() === "dark" ? "light" : "dark";
  localStorage.setItem(storageKey, next);
  applyTheme(next);
});

media.addEventListener("change", () => {
  if (storedTheme() === undefined) {
    applyTheme(preferredTheme());
  }
});

applyTheme(activeTheme());
