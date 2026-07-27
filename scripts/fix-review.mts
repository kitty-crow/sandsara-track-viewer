import { readFile, writeFile } from "node:fs/promises";

async function read(path: string): Promise<string> {
  return readFile(path, "utf8");
}

async function write(path: string, text: string): Promise<void> {
  await writeFile(path, text, "utf8");
}

function replaceOne(text: string, before: string, after: string, label: string): string {
  if (text.includes(after)) {
    return text;
  }
  if (!text.includes(before)) {
    throw new Error(`Missing ${label}`);
  }
  return text.replace(before, after);
}

const pkgPath = "package.json";
const pkg = JSON.parse(await read(pkgPath)) as {
  displayName?: string;
  nameOf?: string;
  activationEvents?: string[];
  contributes?: {
    commands?: Array<{ command?: string }>;
    customEditors?: Array<{ displayName?: string; nameOf?: string }>;
    viewsWelcome?: Array<{ contents?: string }>;
    menus?: { explorer?: Array<{ command?: string }> };
  };
};

pkg.displayName = pkg.nameOf ?? pkg.displayName ?? "Sandsara Track Viewer";
delete pkg.nameOf;

const editor = pkg.contributes?.customEditors?.[0];
if (editor !== undefined) {
  editor.displayName = editor.nameOf ?? editor.displayName ?? "Sandsara Track Preview";
  delete editor.nameOf;
}

pkg.activationEvents = pkg.activationEvents?.map(event =>
  event === "onCommand:sandsara.vectorise" ? "onCommand:sandsara.vectoriseImage" : event
);
for (const command of pkg.contributes?.commands ?? []) {
  if (command.command === "sandsara.vectorise") {
    command.command = "sandsara.vectoriseImage";
  }
}
for (const welcome of pkg.contributes?.viewsWelcome ?? []) {
  if (welcome.contents !== undefined) {
    welcome.contents = welcome.contents.replaceAll(
      "command:sandsara.vectorise)",
      "command:sandsara.vectoriseImage)"
    );
  }
}
for (const item of pkg.contributes?.menus?.explorer ?? []) {
  if (item.command === "sandsara.vectorise") {
    item.command = "sandsara.vectoriseImage";
  }
}
await write(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

const extPath = "src/extension.ts";
let ext = await read(extPath);
ext = replaceOne(
  ext,
  'const VECTORISE_COMMAND = "sandsara.vectorise";',
  'const VECTORISE_COMMAND = "sandsara.vectoriseImage";',
  "public vectorise command ID"
);
await write(extPath, ext);

const workerPath = "src/webview/routerWorkerClient.ts";
let worker = await read(workerPath);
worker = replaceOne(
  worker,
  'new URL("./routeWorker.js", import.meta.url)',
  'new URL("./routerWorker.js", import.meta.url)',
  "router worker URL"
);
await write(workerPath, worker);

console.log("Review regressions corrected.");
