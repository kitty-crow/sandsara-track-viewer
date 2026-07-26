#!/usr/bin/env python3
import json
from pathlib import Path

package_path = Path("package.json")
package = json.loads(package_path.read_text(encoding="utf-8"))
package["devDependencies"].pop("@kitty-crow/baguette", None)
package_path.write_text(json.dumps(package, indent=2) + "\n", encoding="utf-8")

build_path = Path("scripts/build.mts")
build = build_path.read_text(encoding="utf-8")
build = build.replace(
    'const executable = process.platform === "win32" ? "npx.cmd" : "npx";\n',
    'const executable = process.platform === "win32" ? "npx.cmd" : "npx";\n'
    'const npmExecutable = process.platform === "win32" ? "npm.cmd" : "npm";\n',
    1,
)
build = build.replace(
    'await compileRouterWasm();\nawait copyStaticSite();',
    'await compileRouterWasm();\nvalidateRouterWasm();\nawait copyStaticSite();',
    1,
)
old = '''async function compileRouterWasm(): Promise<void> {
  try {
    await access(join("baguette", "src", "compiler.ts"));
  } catch {
    throw new Error(
      "The Baguette submodule is missing. Run git submodule update --init --recursive."
    );
  }

  const args = ['''
new = '''async function compileRouterWasm(): Promise<void> {
  await ensureBaguetteToolchain();

  const args = ['''
if old not in build:
    raise SystemExit("Could not locate compileRouterWasm preamble")
build = build.replace(old, new, 1)
insertion = '''
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
    await access(join("baguette", "node_modules", "assemblyscript", "bin", "asc.js"));
    return;
  } catch {
    // Install the compiler's pinned dependencies inside the build-only submodule.
  }

  const install = spawnSync(
    npmExecutable,
    ["install", "--prefix", "baguette", "--no-package-lock", "--ignore-scripts"],
    { stdio: "inherit", shell: false }
  );
  if (install.error !== undefined) {
    throw install.error;
  }
  if (install.status !== 0) {
    throw new Error("Could not install Baguette's build dependencies.");
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

'''
marker = 'async function copyRouterWasm(): Promise<void> {'
if marker not in build:
    raise SystemExit("Could not locate copyRouterWasm")
build_path.write_text(build.replace(marker, insertion + marker, 1), encoding="utf-8")

client_path = Path("src/webview/routerWorkerClient.ts")
client = client_path.read_text(encoding="utf-8")
old_catch = '''  } catch {
    workerUnavailable = true;'''
new_catch = '''  } catch (error: unknown) {
    console.error(
      "The WebAssembly router failed; using the slower TypeScript fallback.",
      error
    );
    workerUnavailable = true;'''
if old_catch not in client:
    raise SystemExit("Could not locate the router fallback")
client_path.write_text(client.replace(old_catch, new_catch, 1), encoding="utf-8")
