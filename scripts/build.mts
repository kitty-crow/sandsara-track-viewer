import { spawn, spawnSync } from "node:child_process";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";

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
  await injectVectoriserProgress();
  await rewriteBrowserModuleSpecifiers(join("dist", "site", "assets"));
} else {
  const children = projects.map(project => spawn(
    executable,
    ["tsc", "--project", project, "--watch", "--preserveWatchOutput"],
    { stdio: "inherit", shell: false }
  ));

  const rewriteTimer = setInterval(() => {
    void prepareGeneratedBrowserFiles().catch(error => {
      console.error("Could not prepare generated browser files", error);
    });
  }, 600);

  const stop = (): void => {
    clearInterval(rewriteTimer);
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

async function prepareGeneratedBrowserFiles(): Promise<void> {
  await injectVectoriserProgress();
  await rewriteBrowserModuleSpecifiers(join("dist", "site", "assets"));
}

async function injectVectoriserProgress(): Promise<void> {
  const entrypoints = [
    join("dist", "webviews", "imageVectoriser.js"),
    join("dist", "site", "assets", "webview", "imageVectoriser.js")
  ];
  const importLine = 'import "./vectoriserProgress.js";\n';

  await Promise.all(entrypoints.map(async target => {
    let source: string;
    try {
      source = await readFile(target, "utf8");
    } catch (error: unknown) {
      if (isMissingPath(error)) {
        return;
      }
      throw error;
    }

    if (!source.startsWith(importLine)) {
      await writeFile(target, `${importLine}${source}`, "utf8");
    }
  }));
}

async function rewriteBrowserModuleSpecifiers(directory: string): Promise<void> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error: unknown) {
    if (isMissingPath(error)) {
      return;
    }
    throw error;
  }

  await Promise.all(entries.map(async entry => {
    const target = join(directory, entry.name);
    if (entry.isDirectory()) {
      await rewriteBrowserModuleSpecifiers(target);
      return;
    }

    if (extname(entry.name) !== ".js") {
      return;
    }

    const original = await readFile(target, "utf8");
    const rewritten = original
      .replace(
        /(\bfrom\s*["'])(\.{1,2}\/[^"']+)(["'])/g,
        (_match, prefix: string, specifier: string, suffix: string) =>
          `${prefix}${withJavaScriptExtension(specifier)}${suffix}`
      )
      .replace(
        /(\bimport\(\s*["'])(\.{1,2}\/[^"']+)(["']\s*\))/g,
        (_match, prefix: string, specifier: string, suffix: string) =>
          `${prefix}${withJavaScriptExtension(specifier)}${suffix}`
      );

    if (rewritten !== original) {
      await writeFile(target, rewritten, "utf8");
    }
  }));
}

function withJavaScriptExtension(specifier: string): string {
  return /\.[a-z0-9]+$/i.test(specifier) ? specifier : `${specifier}.js`;
}

function isMissingPath(error: unknown): boolean {
  return typeof error === "object" && error !== null &&
    "code" in error && error.code === "ENOENT";
}
