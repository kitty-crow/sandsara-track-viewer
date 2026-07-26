export type MsgFn = (msg: unknown) => void | Promise<void>;

export class Host {
  constructor(private readonly fn: MsgFn) {}

  init(): void {
    const acquire = <State = unknown>(): VsCodeApi<State> => {
      let state: State | undefined;
      return {
        postMessage: msg => void Promise.resolve(this.fn(msg)).catch(console.error),
        getState: () => state,
        setState: next => { state = next; }
      };
    };
    (globalThis as unknown as Record<string, unknown>).acquireVsCodeApi = acquire;
  }

  send(msg: unknown): void {
    window.dispatchEvent(new MessageEvent("message", { data: msg }));
  }
}

export class UI {
  static el<T extends HTMLElement>(id: string): T {
    const node = document.getElementById(id);
    if (node === null) throw new Error(`Missing page element: ${id}`);
    return node as T;
  }

  static is(msg: unknown, type: string): msg is Record<string, unknown> & { readonly type: string } {
    return typeof msg === "object" && msg !== null && "type" in msg && msg.type === type;
  }

  static note(text: string, bad = false): void {
    const node = document.getElementById("siteStatus");
    if (node === null) return;
    node.textContent = text;
    node.classList.toggle("error", bad);
  }

  static err(value: unknown): string {
    return value instanceof Error ? value.message : String(value);
  }
}

export class Files {
  static text(text: string, name: string, mime: string): void {
    this.blob(new Blob([text], { type: mime }), name);
  }

  static bytes(data: Uint8Array, name: string, mime = "application/octet-stream"): void {
    const copy = new Uint8Array(data.byteLength);
    copy.set(data);
    this.blob(new Blob([copy], { type: mime }), name);
  }

  static name(value: string, fallback: string): string {
    const out = value.trim();
    return out ? out.replace(/[\\/:*?"<>|\u0000-\u001F]/g, "-") : fallback;
  }

  private static blob(blob: Blob, name: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.hidden = true;
    document.body.append(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }
}

export class Drop {
  constructor(
    private readonly input: HTMLInputElement,
    private readonly fn: (file: File) => void
  ) {}

  init(): void {
    const box = this.input.closest<HTMLElement>(".upload-panel");
    if (box === null) return;

    for (const name of ["dragenter", "dragover"]) {
      box.addEventListener(name, e => {
        e.preventDefault();
        box.classList.add("drag-active");
      });
    }

    for (const name of ["dragleave", "drop"]) {
      box.addEventListener(name, e => {
        e.preventDefault();
        box.classList.remove("drag-active");
      });
    }

    box.addEventListener("drop", e => {
      const file = e.dataTransfer?.files[0];
      if (file !== undefined) this.fn(file);
    });
  }
}
