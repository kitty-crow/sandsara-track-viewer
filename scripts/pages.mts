import { spawnSync } from "node:child_process";
import { access, rename, rm } from "node:fs/promises";
import { join } from "node:path";

const template = join("vendor", "pages", "src", "cli.ts");
const source = join("dist", "site");
const output = join("dist", "site-pages");

await ensureTemplate();

const executable = process.platform === "win32" ? "bun.exe" : "bun";
const result = spawnSync(executable, [template, "build", "pages.config.ts"], {
  stdio: "inherit",
  shell: false
});

if (result.error !== undefined) {
  throw result.error;
}
if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

await rm(source, { recursive: true, force: true });
await rename(output, source);

async function ensureTemplate(): Promise<void> {
  try {
    await access(template);
    return;
  } catch {
    const update = spawnSync(
      "git",
      ["submodule", "update", "--init", "--recursive", "vendor/pages"],
      { stdio: "inherit", shell: false }
    );

    if (update.error !== undefined) {
      throw update.error;
    }
    if (update.status !== 0) {
      throw new Error("Could not initialise the pinned GitHub Pages template submodule.");
    }
  }
}
