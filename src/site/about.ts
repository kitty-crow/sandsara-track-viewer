export {};

class MdView {
  private readonly src = "https://raw.githubusercontent.com/kitty-crow/sandsara-track-viewer/main/README.md";
  private readonly repo = "https://github.com/kitty-crow/sandsara-track-viewer";
  private readonly body = this.el<HTMLElement>("readmeContent");
  private readonly note = this.el<HTMLElement>("readmeStatus");

  async run(): Promise<void> {
    try {
      this.note.textContent = "Fetching the latest README from GitHub…";
      const res = await fetch(`${this.src}?v=${Date.now()}`, {
        headers: { Accept: "text/markdown,text/plain;q=0.9,*/*;q=0.1" },
        cache: "no-store"
      });
      if (!res.ok) throw new Error(`GitHub returned ${res.status} ${res.statusText}`);
      this.render(await res.text(), this.body);
      this.note.textContent = "Showing the current README from the main branch on GitHub.";
    } catch (err: unknown) {
      this.note.textContent = `The live README could not be loaded: ${this.err(err)}`;
      this.note.classList.add("error");
      const p = document.createElement("p");
      p.append("Open the ");
      const a = document.createElement("a");
      a.href = this.repo;
      a.textContent = "project repository on GitHub";
      p.append(a, " to read the documentation.");
      this.body.replaceChildren(p);
    }
  }

  private render(md: string, out: HTMLElement): void {
    const lines = md.replace(/\r\n?/g, "\n").split("\n");
    const frag = document.createDocumentFragment();
    let i = 0;

    while (i < lines.length) {
      const line = lines[i] ?? "";
      if (line.trim() === "") { i++; continue; }

      if (line.startsWith("```")) {
        const lang = line.slice(3).trim();
        const buf: string[] = [];
        for (i++; i < lines.length && !(lines[i] ?? "").startsWith("```"); i++) buf.push(lines[i] ?? "");
        i++;
        const pre = document.createElement("pre");
        const code = document.createElement("code");
        if (lang) code.className = `language-${this.safeCls(lang)}`;
        code.textContent = buf.join("\n");
        pre.append(code);
        frag.append(pre);
        continue;
      }

      const h = /^(#{1,6})\s+(.+)$/.exec(line);
      if (h !== null) {
        const node = document.createElement(`h${h[1]?.length ?? 1}`);
        this.inline(node, h[2] ?? "");
        frag.append(node);
        i++;
        continue;
      }

      if (/^\s*---+\s*$/.test(line)) {
        frag.append(document.createElement("hr"));
        i++;
        continue;
      }

      if (line.startsWith(">")) {
        const q: string[] = [];
        while (i < lines.length && (lines[i] ?? "").startsWith(">")) {
          q.push((lines[i] ?? "").replace(/^>\s?/, ""));
          i++;
        }
        const quote = document.createElement("blockquote");
        this.render(q.join("\n"), quote);
        frag.append(quote);
        continue;
      }

      if (this.isTable(lines, i)) {
        const rows = [line];
        i += 2;
        while (i < lines.length && (lines[i] ?? "").includes("|")) rows.push(lines[i++] ?? "");
        frag.append(this.table(rows));
        continue;
      }

      const ul = /^\s*[-*+]\s+(.+)$/.exec(line);
      const ol = /^\s*\d+\.\s+(.+)$/.exec(line);
      if (ul !== null || ol !== null) {
        const list = document.createElement(ol !== null ? "ol" : "ul");
        const rx = ol !== null ? /^\s*\d+\.\s+(.+)$/ : /^\s*[-*+]\s+(.+)$/;
        while (i < lines.length) {
          const m = rx.exec(lines[i] ?? "");
          if (m === null) break;
          const li = document.createElement("li");
          this.inline(li, m[1] ?? "");
          list.append(li);
          i++;
        }
        frag.append(list);
        continue;
      }

      const pLines = [line.trim()];
      for (i++; i < lines.length; i++) {
        const next = lines[i] ?? "";
        if (next.trim() === "" || this.block(lines, i)) break;
        pLines.push(next.trim());
      }
      const p = document.createElement("p");
      this.inline(p, pLines.join(" "));
      frag.append(p);
    }

    out.replaceChildren(frag);
  }

  private inline(out: HTMLElement, src: string): void {
    const rx = /(\[([^\]]+)\]\(([^)]+)\)|`([^`]+)`|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*]+)\*)/g;
    let pos = 0;
    for (const m of src.matchAll(rx)) {
      const at = m.index ?? 0;
      if (at > pos) out.append(document.createTextNode(src.slice(pos, at)));
      if (m[2] !== undefined && m[3] !== undefined) {
        const a = document.createElement("a");
        a.textContent = m[2];
        a.href = this.link(m[3]);
        if (a.hostname !== location.hostname) { a.target = "_blank"; a.rel = "noopener noreferrer"; }
        out.append(a);
      } else if (m[4] !== undefined) {
        const code = document.createElement("code"); code.textContent = m[4]; out.append(code);
      } else if (m[5] !== undefined || m[6] !== undefined) {
        const strong = document.createElement("strong"); strong.textContent = m[5] ?? m[6] ?? ""; out.append(strong);
      } else if (m[7] !== undefined) {
        const em = document.createElement("em"); em.textContent = m[7]; out.append(em);
      }
      pos = at + m[0].length;
    }
    if (pos < src.length) out.append(document.createTextNode(src.slice(pos)));
  }

  private table(rows: readonly string[]): HTMLTableElement {
    const table = document.createElement("table");
    const head = document.createElement("thead");
    const body = document.createElement("tbody");
    const hr = document.createElement("tr");
    for (const text of this.cells(rows[0] ?? "")) { const th = document.createElement("th"); this.inline(th, text); hr.append(th); }
    head.append(hr);
    for (const row of rows.slice(1)) {
      const tr = document.createElement("tr");
      for (const text of this.cells(row)) { const td = document.createElement("td"); this.inline(td, text); tr.append(td); }
      body.append(tr);
    }
    table.append(head, body);
    return table;
  }

  private isTable(lines: readonly string[], i: number): boolean {
    return (lines[i] ?? "").includes("|") && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1] ?? "");
  }

  private block(lines: readonly string[], i: number): boolean {
    const line = lines[i] ?? "";
    return line.startsWith("```") || line.startsWith(">") || /^(#{1,6})\s+/.test(line) ||
      /^\s*[-*+]\s+/.test(line) || /^\s*\d+\.\s+/.test(line) || /^\s*---+\s*$/.test(line) || this.isTable(lines, i);
  }

  private cells(line: string): string[] {
    return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(x => x.trim());
  }

  private link(value: string): string {
    try { return new URL(value, `${this.repo}/blob/main/`).href; } catch { return this.repo; }
  }

  private safeCls(value: string): string { return value.toLowerCase().replace(/[^a-z0-9_-]/g, "-"); }
  private err(value: unknown): string { return value instanceof Error ? value.message : String(value); }

  private el<T extends HTMLElement>(id: string): T {
    const node = document.getElementById(id);
    if (node === null) throw new Error(`Missing page element: ${id}`);
    return node as T;
  }
}

void new MdView().run();
