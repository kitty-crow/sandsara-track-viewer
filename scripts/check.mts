import { spawnSync } from "node:child_process";

const executable = process.platform === "win32" ? "npx.cmd" : "npx";
const projects = [
  "tsconfig.extension.json",
  "tsconfig.webviews.json",
  "tsconfig.scripts.json"
];

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
