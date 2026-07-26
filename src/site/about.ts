const readmeUrl = "https://raw.githubusercontent.com/kitty-crow/sandsara-track-viewer/main/README.md";
const repositoryUrl = "https://github.com/kitty-crow/sandsara-track-viewer";
const content = requiredElement<HTMLElement>("readmeContent");
const statusEl = requiredElement<HTMLElement>("readmeStatus");

void loadReadme();

async function loadReadme(): Promise<void> {
  try {
    statusEl.textContent = "Fetching the latest README from GitHub…";
    const response = await fetch(readmeUrl, {
      headers: { Accept: "text/markdown,text/plain;q=0.9,*/*;q=0.1" },
      cache: "no-cache"
    });

    if (!response.ok) {
      throw new Error(`GitHub returned ${response.status} ${response.statusText}`);
    }

    const markdown = await response.text();
    renderMarkdown(markdown, content);
    statusEl.textContent = "Showing the current README from the main branch on GitHub.";
  } catch (error: unknown) {
    statusEl.textContent = `The live README could not be loaded: ${errorMessage(error)}`;
    statusEl.classList.add("error");

    const paragraph = document.createElement("p");
    paragraph.append("Open the ");
    const link = document.createElement("a");
    link.href = repositoryUrl;
    link.textContent = "project repository on GitHub";
    paragraph.append(link, " to read the documentation.");
    content.replaceChildren(paragraph);
  }
}

function renderMarkdown(markdown: string, target: HTMLElement): void {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const fragment = document.createDocumentFragment();
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";

    if (line.trim() === "") {
      index += 1;
      continue;
    }

    if (line.startsWith("```")) {
      const language = line.slice(3).trim();
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !(lines[index] ?? "").startsWith("```")) {
        codeLines.push(lines[index] ?? "");
        index += 1;
      }
      index += 1;
      const pre = document.createElement("pre");
      const code = document.createElement("code");
      if (language !== "") code.className = `language-${safeClassName(language)}`;
      code.textContent = codeLines.join("\n");
      pre.append(code);
      fragment.append(pre);
      continue;
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading !== null) {
      const level = heading[1]?.length ?? 1;
      const element = document.createElement(`h${level}`);
      appendInline(element, heading[2] ?? "");
      fragment.append(element);
      index += 1;
      continue;
    }

    if (/^\s*---+\s*$/.test(line)) {
      fragment.append(document.createElement("hr"));
      index += 1;
      continue;
    }

    if (line.startsWith(">")) {
      const quoteLines: string[] = [];
      while (index < lines.length && (lines[index] ?? "").startsWith(">")) {
        quoteLines.push((lines[index] ?? "").replace(/^>\s?/, ""));
        index += 1;
      }
      const quote = document.createElement("blockquote");
      renderMarkdown(quoteLines.join("\n"), quote);
      fragment.append(quote);
      continue;
    }

    if (isTableStart(lines, index)) {
      const tableLines: string[] = [line];
      index += 2;
      while (index < lines.length && (lines[index] ?? "").includes("|")) {
        tableLines.push(lines[index] ?? "");
        index += 1;
      }
      fragment.append(createTable(tableLines));
      continue;
    }

    const unordered = /^\s*[-*+]\s+(.+)$/.exec(line);
    const ordered = /^\s*\d+\.\s+(.+)$/.exec(line);
    if (unordered !== null || ordered !== null) {
      const list = document.createElement(ordered !== null ? "ol" : "ul");
      const pattern = ordered !== null ? /^\s*\d+\.\s+(.+)$/ : /^\s*[-*+]\s+(.+)$/;
      while (index < lines.length) {
        const match = pattern.exec(lines[index] ?? "");
        if (match === null) break;
        const item = document.createElement("li");
        appendInline(item, match[1] ?? "");
        list.append(item);
        index += 1;
      }
      fragment.append(list);
      continue;
    }

    const paragraphLines = [line.trim()];
    index += 1;
    while (index < lines.length) {
      const next = lines[index] ?? "";
      if (next.trim() === "" || startsBlock(lines, index)) break;
      paragraphLines.push(next.trim());
      index += 1;
    }
    const paragraph = document.createElement("p");
    appendInline(paragraph, paragraphLines.join(" "));
    fragment.append(paragraph);
  }

  target.replaceChildren(fragment);
}

function appendInline(parent: HTMLElement, source: string): void {
  const pattern = /(\[([^\]]+)\]\(([^)]+)\)|`([^`]+)`|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*]+)\*)/g;
  let cursor = 0;

  for (const match of source.matchAll(pattern)) {
    const position = match.index ?? 0;
    if (position > cursor) parent.append(document.createTextNode(source.slice(cursor, position)));

    if (match[2] !== undefined && match[3] !== undefined) {
      const link = document.createElement("a");
      link.textContent = match[2];
      link.href = resolveLink(match[3]);
      if (link.hostname !== window.location.hostname) {
        link.target = "_blank";
        link.rel = "noopener noreferrer";
      }
      parent.append(link);
    } else if (match[4] !== undefined) {
      const code = document.createElement("code");
      code.textContent = match[4];
      parent.append(code);
    } else if (match[5] !== undefined || match[6] !== undefined) {
      const strong = document.createElement("strong");
      strong.textContent = match[5] ?? match[6] ?? "";
      parent.append(strong);
    } else if (match[7] !== undefined) {
      const emphasis = document.createElement("em");
      emphasis.textContent = match[7];
      parent.append(emphasis);
    }

    cursor = position + match[0].length;
  }

  if (cursor < source.length) parent.append(document.createTextNode(source.slice(cursor)));
}

function isTableStart(lines: readonly string[], index: number): boolean {
  const current = lines[index] ?? "";
  const separator = lines[index + 1] ?? "";
  return current.includes("|") && /^\s*\|?\s*:?-{3,}/.test(separator);
}

function createTable(lines: readonly string[]): HTMLTableElement {
  const table = document.createElement("table");
  const head = document.createElement("thead");
  const body = document.createElement("tbody");
  const headerRow = document.createElement("tr");

  for (const cellText of splitTableRow(lines[0] ?? "")) {
    const cell = document.createElement("th");
    appendInline(cell, cellText);
    headerRow.append(cell);
  }
  head.append(headerRow);

  for (const line of lines.slice(1)) {
    const row = document.createElement("tr");
    for (const cellText of splitTableRow(line)) {
      const cell = document.createElement("td");
      appendInline(cell, cellText);
      row.append(cell);
    }
    body.append(row);
  }

  table.append(head, body);
  return table;
}

function splitTableRow(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(cell => cell.trim());
}

function startsBlock(lines: readonly string[], index: number): boolean {
  const line = lines[index] ?? "";
  return line.startsWith("```") || line.startsWith(">") || /^(#{1,6})\s+/.test(line) ||
    /^\s*[-*+]\s+/.test(line) || /^\s*\d+\.\s+/.test(line) || /^\s*---+\s*$/.test(line) ||
    isTableStart(lines, index);
}

function resolveLink(value: string): string {
  try {
    return new URL(value, `${repositoryUrl}/blob/main/`).href;
  } catch {
    return repositoryUrl;
  }
}

function safeClassName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]/g, "-");
}

function requiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`Missing page element: ${id}`);
  return element as T;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
