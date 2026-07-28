/**
 * wawoff2 ships no type declarations. Only the one function this project uses
 * is declared, rather than pulling in a broad `declare module` that would type
 * the whole package as `any`.
 */
declare module 'wawoff2' {
  /**
   * Decompress WOFF2 bytes to bare SFNT (TTF/OTF) bytes.
   *
   * The returned Uint8Array is a **view onto the WASM heap, not a copy** —
   * a subsequent call overwrites it in place. Copy it (`Buffer.from(...)`)
   * before starting another decompression.
   */
  export function decompress(input: Uint8Array): Promise<Uint8Array>;

  /** Compress SFNT bytes to WOFF2. Unused here, declared for completeness. */
  export function compress(input: Uint8Array): Promise<Uint8Array>;
}
