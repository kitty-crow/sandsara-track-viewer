type Mode = "light" | "dark";

class ThemeCtl {
  private readonly key = "sandsara.theme";
  private readonly media = matchMedia("(prefers-color-scheme: dark)");
  private readonly btn = document.querySelector<HTMLButtonElement>("[data-theme-toggle]");
  private readonly meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');

  run(): void {
    this.btn?.addEventListener("click", () => {
      const next: Mode = this.mode() === "dark" ? "light" : "dark";
      localStorage.setItem(this.key, next);
      this.set(next);
    });
    this.media.addEventListener("change", () => {
      if (this.saved() === undefined) this.set(this.os());
    });
    this.set(this.mode());
  }

  private saved(): Mode | undefined {
    const value = localStorage.getItem(this.key);
    return value === "light" || value === "dark" ? value : undefined;
  }

  private os(): Mode { return this.media.matches ? "dark" : "light"; }
  private mode(): Mode { return this.saved() ?? this.os(); }

  private set(mode: Mode): void {
    document.documentElement.dataset.theme = mode;
    document.documentElement.style.colorScheme = mode;
    if (this.meta !== null) this.meta.content = mode === "dark" ? "#18211d" : "#f3eee4";
    if (this.btn === null) return;
    const dark = mode === "dark";
    this.btn.textContent = dark ? "🌙" : "☀️";
    this.btn.setAttribute("aria-label", dark ? "Dark mode enabled. Switch to light mode" : "Light mode enabled. Switch to dark mode");
    this.btn.setAttribute("title", dark ? "Dark mode enabled" : "Light mode enabled");
    this.btn.setAttribute("aria-pressed", String(dark));
  }
}

new ThemeCtl().run();
