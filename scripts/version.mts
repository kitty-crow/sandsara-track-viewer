import { readFile, writeFile } from "node:fs/promises";

type Mode = "check" | "patch" | "minor" | "major";
type Json = Record<string, unknown>;

const packagePath = "package.json";
const lockPath = "package-lock.json";
const versionPath = "version.json";

const mode = parseMode(process.argv[2] ?? "check");
const packageJson = record(JSON.parse(await readFile(packagePath, "utf8")), packagePath);
const lockJson = record(JSON.parse(await readFile(lockPath, "utf8")), lockPath);
const versionJson = record(JSON.parse(await readFile(versionPath, "utf8")), versionPath);
const packages = record(lockJson["packages"], `${lockPath} packages`);
const lockRoot = record(packages[""], `${lockPath} root package`);

const current = version(packageJson["version"], packagePath);
const lockVersion = version(lockJson["version"], lockPath);
const rootVersion = version(lockRoot["version"], `${lockPath} root package`);
const fileVersion = version(versionJson["version"], versionPath);

if (new Set([current, lockVersion, rootVersion, fileVersion]).size !== 1) {
  throw new Error(`Version mismatch: package=${current}, lock=${lockVersion}, lock root=${rootVersion}, file=${fileVersion}.`);
}

if (mode === "check") {
  console.log(current);
  process.exit(0);
}

const updated = bump(current, mode);
packageJson["version"] = updated;
lockJson["version"] = updated;
lockRoot["version"] = updated;
versionJson["version"] = updated;

await Promise.all([
  writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8"),
  writeFile(lockPath, `${JSON.stringify(lockJson, null, 2)}\n`, "utf8"),
  writeFile(versionPath, `${JSON.stringify(versionJson, null, 2)}\n`, "utf8")
]);

console.log(updated);

function parseMode(value: string): Mode {
  if (value === "check" || value === "patch" || value === "minor" || value === "major") return value;
  throw new Error(`Unknown version mode: ${value}`);
}

function record(value: unknown, label: string): Json {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must contain a JSON object.`);
  }
  return value as Json;
}

function version(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^\d+\.\d+\.\d+$/.test(value)) {
    throw new Error(`${label} has an invalid version.`);
  }
  return value;
}

function bump(value: string, mode: Exclude<Mode, "check">): string {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value);
  if (match === null) throw new Error("Current version is invalid.");

  let major = Number(match[1]);
  let minor = Number(match[2]);
  let patch = Number(match[3]);

  if (mode === "major") {
    major += 1;
    minor = 0;
    patch = 0;
  } else if (mode === "minor") {
    minor += 1;
    patch = 0;
  } else {
    patch += 1;
  }

  return `${major}.${minor}.${patch}`;
}
