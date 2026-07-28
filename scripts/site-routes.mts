import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const out = join("dist", "site");
const routes = ["generator", "visualise", "about"] as const;
const legacy = ["vectorise", "generate"] as const;
const pages = ["index", ...routes] as const;
const links = new Map([
  ["./index.html", "./"],
  ["./generator.html", "./generator"],
  ["./vectorise.html", "./generator#img2svg"],
  ["./generate.html", "./generator#svg2bin"],
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

for (const page of legacy) {
  const html = await readFile(join(out, `${page}.html`), "utf8");
  const dir = join(out, page);
  await mkdir(dir, { recursive: true });
  const nested = html.replace("<head>", '<head>\n  <base href="../">');
  await writeFile(join(dir, "index.html"), nested, "utf8");
}

const cssFile = join(out, "studio-extra.css");
const css = await readFile(cssFile, "utf8");
const oldAbout = '.footer-links a[href="./about.html"]::before';
const cleanAbout = '.footer-links a:is([href="./about"], [href="./about.html"])::before';

if (!css.includes(cleanAbout)) {
  if (!css.includes(oldAbout)) {
    throw new Error("The About footer icon selector is missing.");
  }
  await writeFile(cssFile, css.replace(oldAbout, cleanAbout), "utf8");
}
