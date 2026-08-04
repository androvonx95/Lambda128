/**
 * Type declarations for @xenova/transformers (optional dependency).
 * Only loaded when user enables local embeddings.
 */
declare module '@xenova/transformers' {
  export function pipeline(
    task: string,
    model: string,
    options?: Record<string, unknown>
  ): Promise<Pipeline>;

  interface Pipeline {
    (texts: string[], options?: Record<string, unknown>): Promise<Tensor[]>;
  }

  interface Tensor {
    data: Float32Array;
    dims: number[];
    type: string;
  }
}