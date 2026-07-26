import { spawn, spawnSync } from "node:child_process";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";

class Build {
  private readonly watch = process.argv.includes("--watch");
  private readonly npx = process.platform === "win32" ? "npx.cmd" : "npx";
  private readonly cfgs = [
    "tsconfig.extension.json",
    "tsconfig.webviews.json",
    "tsconfig.site.json"
  ];

  async run(): Promise<void> {
    await rm("dist", { recursive: true, force: true });
    await this.copyWeb();

    if (this.watch) {
      await this.watchAll();
      return;
    }

    for (const cfg of this.cfgs) this.tsc(cfg);
    await this.prepBrw();
  }

  private tsc(cfg: string): void {
    const p = spawnSync(this.npx, ["tsc", "--project", cfg, "--pretty"], {
      stdio: "inherit",
      shell: false
    });
    if (p.error !== undefined) throw p.error;
    if (p.status !== 0) process.exit(p.status ?? 1);
  }

  private async copyWeb(): Promise<void> {
    const out = join("dist", "site");
    await mkdir(out, { recursive: true });
    for (const e of await readdir("web", { withFileTypes: true })) {
      await cp(join("web", e.name), join(out, e.name), {
        recursive: e.isDirectory(),
        force: true
      });
    }
    await writeFile(join(out, ".nojekyll"), "", "utf8");
  }

  private async watchAll(): Promise<void> {
    const kids = this.cfgs.map(cfg => spawn(
      this.npx,
      ["tsc", "--project", cfg, "--watch", "--preserveWatchOutput"],
      { stdio: "inherit", shell: false }
    ));
    const tick = setInterval(() => void this.prepBrw().catch(console.error), 600);
    const stop = (): void => {
      clearInterval(tick);
      for (const kid of kids) kid.kill();
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    const code = await new Promise<number>((ok, fail) => {
      for (const kid of kids) {
        kid.once("error", fail);
        kid.once("exit", value => ok(value ?? 0));
      }
    });
    stop();
    process.exit(code);
  }

  private async prepBrw(): Promise<void> {
    await this.addProg();
    await this.fixImports(join("dist", "site", "assets"));
  }

  private async addProg(): Promise<void> {
    const files = [
      join("dist", "webviews", "imageVectoriser.js"),
      join("dist", "site", "assets", "webview", "imageVectoriser.js")
    ];
    const line = 'import "./vectoriserProgress.js";\n';
    await Promise.all(files.map(async file => {
      const src = await this.read(file);
      if (src !== undefined && !src.startsWith(line)) {
        await writeFile(file, line + src, "utf8");
      }
    }));
  }

  private async fixImports(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (err: unknown) {
      if (this.missing(err)) return;
      throw err;
    }

    await Promise.all(entries.map(async e => {
      const file = join(dir, e.name);
      if (e.isDirectory()) return this.fixImports(file);
      if (extname(e.name) !== ".js") return;
      const src = await readFile(file, "utf8");
      const out = src
        .replace(/(\bfrom\s*["'])(\.{1,2}\/[^"']+)(["'])/g,
          (_m, a: string, p: string, b: string) => `${a}${this.js(p)}${b}`)
        .replace(/(\bimport\(\s*["'])(\.{1,2}\/[^"']+)(["']\s*\))/g,
          (_m, a: string, p: string, b: string) => `${a}${this.js(p)}${b}`);
      if (out !== src) await writeFile(file, out, "utf8");
    }));
  }

  private js(path: string): string {
    return /\.[a-z0-9]+$/i.test(path) ? path : `${path}.js`;
  }

  private async read(file: string): Promise<string | undefined> {
    try {
      return await readFile(file, "utf8");
    } catch (err: unknown) {
      if (this.missing(err)) return undefined;
      throw err;
    }
  }

  private missing(err: unknown): boolean {
    return typeof err === "object" && err !== null && "code" in err && err.code === "ENOENT";
  }
}

await new Build().run();
