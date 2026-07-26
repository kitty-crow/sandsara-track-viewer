import { spawn, spawnSync } from "node:child_process";
import { access, cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";

const watch = process.argv.includes("--watch");
const executable = process.platform === "win32" ? "npx.cmd" : "npx";
const projects = [
  "tsconfig.extension.json",
  "tsconfig.webviews.json",
  "tsconfig.site.json"
];

await rm("dist", { recursive: true, force: true });
await compileRouterWasm();
validateRouterWasm();
await copyStaticSite();
await copyRouterWasm();

if (!watch) {
  for (const project of projects) {
    runTypeScript(project);
  }
  await rewriteBrowserModuleSpecifiers(join("dist", "site", "assets"));
} else {
  const children = projects.map(project => spawn(
    executable,
    ["tsc", "--project", project, "--watch", "--preserveWatchOutput"],
    { stdio: "inherit", shell: false }
  ));

  const rewriteTimer = setInterval(() => {
    void rewriteBrowserModuleSpecifiers(join("dist", "site", "assets")).catch(error => {
      console.error("Could not rewrite generated browser imports", error);
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

async function compileRouterWasm(): Promise<void> {
  await ensureBaguetteToolchain();

  const args = [
    "--disable-warning=ExperimentalWarning",
    "--experimental-strip-types",
    join("baguette", "src", "compiler.ts"),
    "--config",
    "baguette.router.config.json"
  ];
  if (watch) {
    args.push("--skip-determinism-check");
  }

  const result = spawnSync(process.execPath, args, {
    stdio: "inherit",
    shell: false
  });
  if (result.error !== undefined) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}


async function ensureBaguetteToolchain(): Promise<void> {
  try {
    await access(join("baguette", "src", "compiler.ts"));
  } catch {
    const update = spawnSync(
      "git",
      ["submodule", "update", "--init", "--recursive", "baguette"],
      { stdio: "inherit", shell: false }
    );
    if (update.error !== undefined) {
      throw update.error;
    }
    if (update.status !== 0) {
      throw new Error("Could not initialise the pinned Baguette submodule.");
    }
  }

  try {
    await access(join("node_modules", "assemblyscript", "package.json"));
    await access(join("node_modules", "binaryen", "package.json"));
  } catch {
    throw new Error(
      "Baguette's pinned AssemblyScript and Binaryen dependencies are missing. Run npm ci."
    );
  }
}

function validateRouterWasm(): void {
  const result = spawnSync(
    process.execPath,
    [
      "--disable-warning=ExperimentalWarning",
      "--experimental-strip-types",
      join("scripts", "validate-router-wasm.mts")
    ],
    { stdio: "inherit", shell: false }
  );
  if (result.error !== undefined) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

async function copyRouterWasm(): Promise<void> {
  const source = join("build", "router-wasm", "path-router.wasm");
  const targets = [
    join("dist", "webviews", "path-router.wasm"),
    join("dist", "site", "assets", "webview", "path-router.wasm")
  ];
  for (const target of targets) {
    await mkdir(join(target, ".."), { recursive: true });
    await cp(source, target, { force: true });
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
