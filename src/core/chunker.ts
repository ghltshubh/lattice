/**
 * Chunking (BUILD_PLAN §7): ~900 tokens/chunk with ~120 token overlap.
 * Prefers paragraph/heading boundaries over hard cuts; overlap carries
 * coreference across chunk boundaries.
 */

import { estimateTokens } from "./tokens";
import type { Chunk } from "./types";

export interface ChunkOptions {
  targetTokens?: number;
  overlapTokens?: number;
}

const DEFAULTS: Required<ChunkOptions> = { targetTokens: 900, overlapTokens: 120 };

/** Split on blank lines and markdown-style headings, keeping headings with what follows. */
function splitBlocks(text: string): string[] {
  const rough = text
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n|(?=^#{1,6}\s)/m)
    .map((b) => b.trim())
    .filter((b) => b.length > 0);
  return rough;
}

/** Hard-split an oversized block on sentence boundaries (fallback: raw slices). */
function splitSentences(block: string, maxTokens: number): string[] {
  const sentences = block.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) ?? [block];
  const out: string[] = [];
  let cur = "";
  for (const s of sentences) {
    if (cur && estimateTokens(cur + s) > maxTokens) {
      out.push(cur.trim());
      cur = s;
    } else {
      cur += s;
    }
    // A single sentence can still exceed the budget — slice it raw.
    while (estimateTokens(cur) > maxTokens) {
      const cut = maxTokens * 4;
      out.push(cur.slice(0, cut).trim());
      cur = cur.slice(cut);
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Take roughly the last `tokens` worth of text, snapped to a sentence start when possible. */
function tail(text: string, tokens: number): string {
  const chars = tokens * 4;
  if (text.length <= chars) return text;
  const slice = text.slice(-chars);
  const m = slice.match(/[.!?]\s+/);
  return m ? slice.slice((m.index ?? 0) + m[0].length) : slice;
}

export function chunkText(text: string, options: ChunkOptions = {}): Chunk[] {
  const { targetTokens, overlapTokens } = { ...DEFAULTS, ...options };
  const pieces = splitBlocks(text).flatMap((b) =>
    estimateTokens(b) > targetTokens ? splitSentences(b, targetTokens) : [b],
  );

  const chunks: Chunk[] = [];
  let cur: string[] = [];
  let curTokens = 0;

  const flush = () => {
    if (cur.length === 0) return;
    const body = cur.join("\n\n");
    const prev = chunks[chunks.length - 1];
    const overlap = prev && overlapTokens > 0 ? tail(prev.text, overlapTokens) : "";
    const full = overlap ? `${overlap}\n\n${body}` : body;
    chunks.push({ index: chunks.length, text: full, tokenEstimate: estimateTokens(full) });
    cur = [];
    curTokens = 0;
  };

  for (const piece of pieces) {
    const t = estimateTokens(piece);
    if (curTokens > 0 && curTokens + t > targetTokens) flush();
    cur.push(piece);
    curTokens += t;
  }
  flush();
  return chunks;
}
