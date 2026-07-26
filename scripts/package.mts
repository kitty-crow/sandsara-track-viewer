import { spawnSync } from "node:child_process";

const executable = process.platform === "win32" ? "npx.cmd" : "npx";
const result = spawnSync(
  executable,
  ["vsce", "package", "--allow-missing-repository"],
  { stdio: "inherit", shell: false }
);

if (result.error !== undefined) {
  throw result.error;
}

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
