/**
 * Lazy Transformers.js embedder (BUILD_PLAN §6 step 4).
 * ~30–90 MB one-time model download, cached by the browser thereafter.
 * Returns null when the runtime can't load it — callers fall back to
 * string similarity (§6 fallback).
 */

import type { Embedder } from "./resolve";

export const EMBEDDING_MODEL = "Xenova/all-MiniLM-L6-v2";

let cached: Promise<Embedder | null> | null = null;

export function getEmbedder(onStatus?: (message: string) => void): Promise<Embedder | null> {
  if (!cached) cached = load(onStatus);
  return cached;
}

async function load(onStatus?: (message: string) => void): Promise<Embedder | null> {
  try {
    const { pipeline } = await import("@huggingface/transformers");
    onStatus?.("Loading embedding model (first run downloads ~30 MB)…");
    let extractor: Awaited<ReturnType<typeof pipeline>>;
    try {
      extractor = await pipeline("feature-extraction", EMBEDDING_MODEL, { device: "webgpu" });
    } catch {
      extractor = await pipeline("feature-extraction", EMBEDDING_MODEL); // WASM fallback
    }
    return async (texts: string[]) => {
      const out = await (
        extractor as (t: string[], o: object) => Promise<{ tolist(): number[][] }>
      )(texts, { pooling: "mean", normalize: true });
      return out.tolist();
    };
  } catch (err) {
    console.warn("Embeddings unavailable, falling back to string similarity:", err);
    return null;
  }
}
