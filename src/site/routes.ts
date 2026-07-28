const pages = new Set(["generator", "visualise", "about"]);

export function cleanPath(path: string): string | null {
  if (path.endsWith("/index.html")) {
    return path.slice(0, -"index.html".length);
  }

  if (path.endsWith("/")) {
    const clean = path.slice(0, -1);
    const name = clean.slice(clean.lastIndexOf("/") + 1);
    return pages.has(name) ? clean : null;
  }

  if (!path.endsWith(".html")) {
    return null;
  }

  const clean = path.slice(0, -".html".length);
  const name = clean.slice(clean.lastIndexOf("/") + 1);
  return pages.has(name) ? clean : null;
}

const path = cleanPath(window.location.pathname);
if (path !== null) {
  const next = `${path}${window.location.search}${window.location.hash}`;
  window.history.replaceState(window.history.state, "", next);
}
