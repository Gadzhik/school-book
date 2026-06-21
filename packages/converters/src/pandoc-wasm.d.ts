/** Минимальные типы для pandoc-wasm (пакет без собственных деклараций). */
declare module 'pandoc-wasm' {
  export interface PandocResult {
    stdout: string;
    stderr: string;
    warnings: unknown[];
    files: Record<string, Blob | string>;
    mediaFiles: Record<string, Blob>;
  }
  export function convert(
    options: Record<string, unknown>,
    stdin: string | Blob,
    files?: Record<string, unknown>,
  ): Promise<PandocResult>;
  export function query(options: Record<string, unknown>, stdin: string | Blob): Promise<unknown>;
  export function pandoc(args: string, inData?: string | Blob, resources?: unknown[]): Promise<unknown>;
}
