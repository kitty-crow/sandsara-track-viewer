import { spawnSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import { extname, join, relative } from "node:path";

const executable = process.platform === "win32" ? "npx.cmd" : "npx";
const projects = [
  "tsconfig.extension.json",
  "tsconfig.webviews.json",
  "tsconfig.site.json",
  "tsconfig.scripts.json",
  "tsconfig.router-wasm.json"
];

await checkNoJs(".");

for (const project of projects) {
  const result = spawnSync(
    executable,
    ["tsc", "--noEmit", "--pretty", "--project", project],
    { stdio: "inherit", shell: false }
  );

  if (result.error !== undefined) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

async function checkNoJs(root: string): Promise<void> {
  const ignoredDirectories = new Set([
    ".git",
    ".pages-cache",
    ".vscode-test",
    "baguette",
    "build",
    "dist",
    "node_modules",
    "out",
    "vendor"
  ]);
  const forbidden: string[] = [];

  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && ignoredDirectories.has(entry.name)) {
        continue;
      }

      const target = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(target);
        continue;
      }

      if ([".js", ".mjs", ".cjs"].includes(extname(entry.name).toLowerCase())) {
        forbidden.push(relative(root, target));
      }
    }
  }

  await visit(root);

  if (forbidden.length > 0) {
    console.error("Authored JavaScript is not allowed. Move source to .ts or .mts:");
    for (const filename of forbidden.sort()) {
      console.error(`  ${filename}`);
    }
    process.exit(1);
  }
}
