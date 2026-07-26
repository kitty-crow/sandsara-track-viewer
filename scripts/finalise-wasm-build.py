#!/usr/bin/env python3
import json
from pathlib import Path

package_path = Path("package.json")
package = json.loads(package_path.read_text(encoding="utf-8"))
dev_dependencies = package["devDependencies"]
dev_dependencies.pop("@kitty-crow/baguette", None)
dev_dependencies["assemblyscript"] = "0.28.19"
dev_dependencies["binaryen"] = "130.0.0-nightly.20260609"
package_path.write_text(json.dumps(package, indent=2) + "\n", encoding="utf-8")

build_path = Path("scripts/build.mts")
build = build_path.read_text(encoding="utf-8")
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
