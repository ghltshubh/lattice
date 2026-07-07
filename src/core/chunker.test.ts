import { describe, expect, it } from "vitest";
import { chunkText } from "./chunker";
import { estimateTokens } from "./tokens";

const PARA = `The quick brown fox jumps over the lazy dog near the riverbank every morning. ${"It keeps running through the tall grass and never seems to tire at all. ".repeat(8)}`;

describe("chunkText", () => {
  it("returns a single chunk for short text", () => {
    const chunks = chunkText("One short paragraph.");
    expect(chunks).toHaveLength(1);
    expect(chunks[0].index).toBe(0);
    expect(chunks[0].text).toContain("One short paragraph.");
  });

  it("keeps chunks near the token budget", () => {
    const text = Array.from({ length: 20 }, () => PARA).join("\n\n");
    const chunks = chunkText(text, { targetTokens: 300, overlapTokens: 40 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      // budget + overlap + one paragraph of slack
      expect(c.tokenEstimate).toBeLessThan(300 + 40 + estimateTokens(PARA));
    }
  });

  it("carries overlap from the previous chunk", () => {
    const text = Array.from({ length: 20 }, (_, i) => `Paragraph number ${i}. ${PARA}`).join(
      "\n\n",
    );
    const chunks = chunkText(text, { targetTokens: 300, overlapTokens: 60 });
    const prevEnd = chunks[0].text.slice(-80);
    // The head of chunk 1 must repeat material from the end of chunk 0.
    expect(chunks[1].text.slice(0, 400)).toContain(prevEnd.slice(-40).trim());
  });

  it("hard-splits a single oversized paragraph", () => {
    const oneBlock = "A sentence goes here. ".repeat(400);
    const chunks = chunkText(oneBlock, { targetTokens: 200, overlapTokens: 0 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.tokenEstimate).toBeLessThanOrEqual(220);
  });

  it("indexes chunks sequentially", () => {
    const text = Array.from({ length: 10 }, () => PARA).join("\n\n");
    const chunks = chunkText(text, { targetTokens: 300 });
    expect(chunks.map((c) => c.index)).toEqual(chunks.map((_, i) => i));
  });
});
