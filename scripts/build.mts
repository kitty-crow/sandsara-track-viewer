import { spawn, spawnSync } from "node:child_process";
import { cp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const watch = process.argv.includes("--watch");
const executable = process.platform === "win32" ? "npx.cmd" : "npx";
const projects = [
  "tsconfig.extension.json",
  "tsconfig.webviews.json",
  "tsconfig.site.json"
];

await rm("dist", { recursive: true, force: true });
await copyStaticSite();

if (!watch) {
  for (const project of projects) {
    runTypeScript(project);
  }
} else {
  const children = projects.map(project => spawn(
    executable,
    ["tsc", "--project", project, "--watch", "--preserveWatchOutput"],
    { stdio: "inherit", shell: false }
  ));

  const stop = (): void => {
    for (const child of children) {
      child.kill();
    }
  };

  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  const exitCode = await new Promise<number>((resolve, reject) => {
    for (const child of children) {
      child.once("error", reject);
      child.once("exit", code => resolve(code ?? 0));
    }
  });

  stop();
  process.exit(exitCode);
}

function runTypeScript(project: string): void {
  const result = spawnSync(
    executable,
    ["tsc", "--project", project, "--pretty"],
    { stdio: "inherit", shell: false }
  );

  if (result.error !== undefined) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

async function copyStaticSite(): Promise<void> {
  const outputDirectory = join("dist", "site");
  await mkdir(outputDirectory, { recursive: true });

  for (const entry of await readdir("web", { withFileTypes: true })) {
    await cp(
      join("web", entry.name),
      join(outputDirectory, entry.name),
      { recursive: entry.isDirectory(), force: true }
    );
  }

  await writeFile(join(outputDirectory, ".nojekyll"), "", "utf8");
}
