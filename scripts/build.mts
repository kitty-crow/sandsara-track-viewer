import { spawn, spawnSync } from "node:child_process";
import { access, cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import ts from "typescript";

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
const tsWorkerModules = [
  ["./routingGeometry", join("src", "webview", "routingGeometry.ts")],
  ["./radialRouting", join("src", "webview", "radialRouting.ts")],
  ["./routeGraph", join("src", "webview", "routeGraph.ts")],
  ["./routePlanner", join("src", "webview", "routePlanner.ts")],
  ["./pathRouter", join("src", "webview", "pathRouter.ts")],
  ["./routerTsWorker", join("src", "webview", "routerTsWorker.ts")]
] as const;
const wasmBuilds = [
  {
    config: "baguette.router.config.json",
    source: join("build", "router-wasm", "path-router.wasm"),
    filename: "path-router.wasm"
  },
  {
    config: "baguette.codec.config.json",
    source: join("build", "track-codec", "track-codec.wasm"),
    filename: "track-codec.wasm"
  }
] as const;

await rm("dist", { recursive: true, force: true });
await buildWasm();
await copySite();
await copyWasm();

if (!watch) {
  for (const project of projects) {
    runTs(project);
  }
  await prepareRuntime();
} else {
  const children = projects.map(project => spawn(
    executable,
    ["tsc", "--project", project, "--watch", "--preserveWatchOutput"],
    { stdio: "inherit", shell: false }
  ));

  const rewriteTimer = setInterval(() => {
    void prepareRuntime().catch(error => {
      console.error("Could not prepare generated runtime files", error);
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

  for (const build of wasmBuilds) {
    const args = [
      "--disable-warning=ExperimentalWarning",
      "--experimental-strip-types",
      join("baguette", "src", "compiler.ts"),
      "--config",
      build.config
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
  for (const build of wasmBuilds) {
    const targets = [
      join("dist", "webviews", build.filename),
      join("dist", "site", "assets", "webview", build.filename)
    ];
    for (const target of targets) {
      await mkdir(join(target, ".."), { recursive: true });
      await cp(build.source, target, { force: true });
    }
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

async function prepareRuntime(): Promise<void> {
  await bundleTsWorker();
  await fixRuntimeImports();
}

async function bundleTsWorker(): Promise<void> {
  const chunks: string[] = [
    '"use strict";\n',
    "const __mods = Object.create(null);\n"
  ];

  for (const [id, sourcePath] of tsWorkerModules) {
    const source = await readFile(sourcePath, "utf8");
    const result = ts.transpileModule(source, {
      fileName: sourcePath,
      reportDiagnostics: true,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
        sourceMap: false,
        inlineSourceMap: false,
        declaration: false,
        newLine: ts.NewLineKind.LineFeed
      }
    });

    const diagnostics = result.diagnostics ?? [];
    if (diagnostics.length > 0) {
      const message = ts.formatDiagnosticsWithColorAndContext(diagnostics, {
        getCanonicalFileName: filename => filename,
        getCurrentDirectory: () => process.cwd(),
        getNewLine: () => "\n"
      });
      throw new Error(`Could not bundle the TypeScript router worker:\n${message}`);
    }

    chunks.push(
      `__mods[${JSON.stringify(id)}] = function(module, exports, require) {\n`,
      result.outputText,
      "\n};\n"
    );
  }

  chunks.push(
    "const __cache = Object.create(null);\n",
    "function __req(id) {\n",
    "  const cached = __cache[id];\n",
    "  if (cached !== undefined) return cached.exports;\n",
    "  const factory = __mods[id];\n",
    "  if (factory === undefined) throw new Error(`Missing bundled worker module: ${id}`);\n",
    "  const module = { exports: {} };\n",
    "  __cache[id] = module;\n",
    "  factory(module, module.exports, __req);\n",
    "  return module.exports;\n",
    "}\n",
    "__req(\"./routerTsWorker\");\n"
  );

  const target = join("dist", "webviews", "routerTsWorker.js");
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, chunks.join(""), "utf8");
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

    const source = await readFile(target, "utf8");
    const updated = source.replace(
      /(from\s+["']|import\s*["'])(\.\.?\/[^"']+)(["'])/g,
      (_match, prefix: string, specifier: string, suffix: string) => {
        if (extname(specifier) !== "") {
          return `${prefix}${specifier}${suffix}`;
        }
        return `${prefix}${specifier}.js${suffix}`;
      }
    );

    if (updated !== source) {
      await writeFile(target, updated, "utf8");
    }
  }));
}

async function checkImports(): Promise<void> {
  const missing: string[] = [];
  for (const directory of runtimeDirs) {
    await scanImports(directory, missing);
  }
  if (missing.length > 0) {
    throw new Error(`Generated JavaScript contains unresolved relative imports:\n${missing.join("\n")}`);
  }
}

async function scanImports(directory: string, missing: string[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error: unknown) {
    if (isMissing(error)) return;
    throw error;
  }

  for (const entry of entries) {
    const target = join(directory, entry.name);
    if (entry.isDirectory()) {
      await scanImports(target, missing);
      continue;
    }
    if (extname(entry.name) !== ".js") continue;

    const source = await readFile(target, "utf8");
    const expression = /(from\s+["']|import\s*["'])(\.\.?\/[^"']+)(["'])/g;
    let match;
    while ((match = expression.exec(source)) !== null) {
      const specifier = match[2];
      if (specifier === undefined) continue;
      const imported = resolve(dirname(target), specifier);
      try {
        await access(imported);
      } catch {
        missing.push(`${target}: ${specifier}`);
      }
    }
  }
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null &&
    "code" in error && error.code === "ENOENT";
}
