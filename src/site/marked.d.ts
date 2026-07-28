declare module "marked" {
  export interface MarkedToken {
    readonly type: string;
    readonly raw: string;
    readonly text: string;
  }

  export interface MarkedExtension {
    readonly name: string;
    readonly level: "block" | "inline";
    start?(source: string): number | void;
    tokenizer(source: string): MarkedToken | false;
    renderer(token: MarkedToken): string | false;
  }

  export const marked: {
    use(options: { readonly extensions: readonly MarkedExtension[] }): void;
    parse(source: string, options?: Readonly<Record<string, unknown>>): string | Promise<string>;
  };
}
