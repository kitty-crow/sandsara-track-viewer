import { spawnSync } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";

const root = join("dist", "site");
const pin = "9aa15e2db722a6a7953d10deb7bf72fc1ba6b036";
const required = [
  "index.html",
  "generator.html",
  "visualise.html",
  "about.html",
  "generator/index.html",
  "visualise/index.html",
  "about/index.html",
  "vectorise/index.html",
  "generate/index.html",
  "parts/img2svg.html",
  "parts/svg2bin.html",
  "assets/pages/boot.js",
  "assets/pages/runtime.js",
  "assets/pages/styles.css"
] as const;

for (const path of required) {
  await access(join(root, path));
}

const pinResult = spawnSync("git", ["ls-tree", "HEAD", "vendor/pages"], {
  encoding: "utf8",
  shell: false
});
if (pinResult.error !== undefined) throw pinResult.error;
if (pinResult.status !== 0 || !pinResult.stdout.includes(pin)) {
  throw new Error("The GitHub Pages template submodule is not pinned to the validated revision.");
}

const home = await readFile(join(root, "index.html"), "utf8");
const generator = await readFile(join(root, "generator", "index.html"), "utf8");
const visualise = await readFile(join(root, "visualise", "index.html"), "utf8");
const about = await readFile(join(root, "about", "index.html"), "utf8");
const vectorise = await readFile(join(root, "vectorise", "index.html"), "utf8");
const generate = await readFile(join(root, "generate", "index.html"), "utf8");

expect(home, 'src="./assets/pages/runtime.js"', "home shared runtime");
expect(generator, '<base href="../">', "generator route base");
expect(generator, 'src="../assets/pages/runtime.js"', "generator shared runtime");
expect(generator, 'id="img2svg"', "generator image step");
expect(generator, 'id="svg2bin"', "generator track step");
expect(visualise, '<base href="../">', "visualise route base");
expect(visualise, 'src="../assets/pages/runtime.js"', "visualise shared runtime");
expect(about, '<base href="../">', "about route base");
expect(about, 'src="../assets/pages/runtime.js"', "about shared runtime");
expect(about, 'id="readmeContent"', "about README host");
expect(vectorise, '<base href="../">', "vectorise route base");
expect(vectorise, 'url=./generator#img2svg', "vectorise redirect");
expect(generate, '<base href="../">', "generate route base");
expect(generate, 'url=./generator#svg2bin', "generate redirect");

for (const old of [
  "assets/site/theme.js",
  "assets/site/routes.js",
  "assets/site/about.js"
]) {
  try {
    await access(join(root, old));
    throw new Error(`Duplicated Pages runtime remains: ${old}`);
  } catch (error: unknown) {
    if (error instanceof Error && error.message.startsWith("Duplicated Pages runtime")) throw error;
  }
}

for (const [name, html] of [["home", home], ["generator", generator], ["visualise", visualise], ["about", about]] as const) {
  if (/href="\.\/(?:index|vectorise|generate|generator|visualise|about)\.html"/.test(html)) {
    throw new Error(`${name} still contains an internal .html link.`);
  }
}

function expect(source: string, value: string, label: string): void {
  if (!source.includes(value)) throw new Error(`Missing ${label}: ${value}`);
}
