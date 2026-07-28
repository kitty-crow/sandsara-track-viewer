import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const out = join("dist", "site");
const routes = ["vectorise", "generate", "visualise", "about"] as const;
const pages = ["index", ...routes] as const;
const links = new Map([
  ["./index.html", "./"],
  ["./vectorise.html", "./vectorise"],
  ["./generate.html", "./generate"],
  ["./visualise.html", "./visualise"],
  ["./about.html", "./about"]
]);
const routeJs = '<script type="module" src="./assets/site/routes.js"></script>';

for (const page of pages) {
  const file = join(out, `${page}.html`);
  let html = await readFile(file, "utf8");

  for (const [from, to] of links) {
    html = html.replaceAll(`href="${from}"`, `href="${to}"`);
  }

  if (!html.includes("./assets/site/routes.js")) {
    html = html.replace("</body>", `${routeJs}\n</body>`);
  }

  await writeFile(file, html, "utf8");

  if (page === "index") continue;

  const dir = join(out, page);
  await mkdir(dir, { recursive: true });
  const nested = html.replace("<head>", '<head>\n  <base href="../">');
  await writeFile(join(dir, "index.html"), nested, "utf8");
}
