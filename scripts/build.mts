import { spawn, spawnSync } from "node:child_process";
import { access, cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";

const watch = process.argv.includes("--watch");
const executable = process.platform === "win32" ? "npx.cmd" : "npx";
const projects = [
  "tsconfig.extension.json",
  "tsconfig.webviews.json",
  "tsconfig.site.json"
];
const runtimeDirs = [
  join("dist", "webviews"),
  join("dist", "site", "assets")
];

await rm("dist", { recursive: true, force: true });
await buildWasm();
await copySite();
await copyWasm();

if (!watch) {
  for (const project of projects) {
    runTs(project);
  }
  await fixRuntimeImports();
} else {
  const children = projects.map(project => spawn(
    executable,
    ["tsc", "--project", project, "--watch", "--preserveWatchOutput"],
    { stdio: "inherit", shell: false }
  ));

  const rewriteTimer = setInterval(() => {
    void fixRuntimeImports().catch(error => {
      console.error("Could not prepare generated runtime imports", error);
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

  const exitCode = await new Promise<number>((resolveExit, reject) => {
    for (const child of children) {
      child.once("error", reject);
      child.once("exit", code => resolveExit(code ?? 0));
    }
  });

  stop();
  process.exit(exitCode);
}

function runTs(project: string): void {
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

async function buildWasm(): Promise<void> {
  await ensureBaguette();

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

async function ensureBaguette(): Promise<void> {
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

async function copyWasm(): Promise<void> {
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

async function copySite(): Promise<void> {
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

async function fixRuntimeImports(): Promise<void> {
  for (const directory of runtimeDirs) {
    await fixImports(directory);
  }
  await checkImports();
}

async function fixImports(directory: string): Promise<void> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error: unknown) {
    if (isMissing(error)) {
      return;
    }
    throw error;
  }

  await Promise.all(entries.map(async entry => {
    const target = join(directory, entry.name);
    if (entry.isDirectory()) {
      await fixImports(target);
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
          `${prefix}${jsExt(specifier)}${suffix}`
      )
      .replace(
        /(\bimport\(\s*["'])(\.{1,2}\/[^"']+)(["']\s*\))/g,
        (_match, prefix: string, specifier: string, suffix: string) =>
          `${prefix}${jsExt(specifier)}${suffix}`
      )
      .replace(
        /(\bimport\s*["'])(\.{1,2}\/[^"']+)(["'])/g,
        (_match, prefix: string, specifier: string, suffix: string) =>
          `${prefix}${jsExt(specifier)}${suffix}`
      );

    if (rewritten !== original) {
      await writeFile(target, rewritten, "utf8");
    }
  }));
}

async function checkImports(): Promise<void> {
  const errors: string[] = [];

  async function visit(directory: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error: unknown) {
      if (isMissing(error)) {
        return;
      }
      throw error;
    }

    for (const entry of entries) {
      const target = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(target);
        continue;
      }
      if (extname(entry.name) !== ".js") {
        continue;
      }

      const source = await readFile(target, "utf8");
      const imports = source.matchAll(
        /(?:\bfrom\s*["']|\bimport\s*["']|\bimport\(\s*["'])(\.{1,2}\/[^"']+)["']/g
      );
      for (const match of imports) {
        const specifier = match[1];
        if (specifier === undefined) {
          continue;
        }
        if (extname(specifier) === "") {
          errors.push(`${target}: extensionless runtime import ${specifier}`);
          continue;
        }
        try {
          await access(resolve(dirname(target), specifier));
        } catch {
          errors.push(`${target}: missing runtime import ${specifier}`);
        }
      }
    }
  }

  for (const directory of runtimeDirs) {
    await visit(directory);
  }

  if (errors.length > 0) {
    throw new Error(`Generated runtime imports are invalid:\n${errors.join("\n")}`);
  }
}

function jsExt(specifier: string): string {
  return /\.[a-z0-9]+$/i.test(specifier) ? specifier : `${specifier}.js`;
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null &&
    "code" in error && error.code === "ENOENT";
}
