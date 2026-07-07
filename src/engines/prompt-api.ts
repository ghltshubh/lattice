/**
 * PromptApiEngine (BUILD_PLAN §8): Chrome built-in Gemini Nano via the
 * Prompt API. Constrained output is not fully reliable on Nano, so every
 * call goes through validate-and-retry (max 2 retries), and a failing chunk
 * is dropped by the pipeline rather than aborting the run.
 */

import type { Availability, ChunkContext, ExtractionEngine, ExtractionResult } from "../core/types";
import { buildUserPrompt, RETRY_PROMPT, SYSTEM_PROMPT } from "./prompt";
import { EXTRACTION_SCHEMA } from "./schema";
import { parseExtraction } from "./validate";

const MAX_RETRIES = 2;

export class PromptApiEngine implements ExtractionEngine {
  readonly id = "prompt-api" as const;
  readonly model = "Gemini Nano (Chrome Prompt API)";
  private session: ChromeAILanguageModelSession | null = null;

  async isAvailable(): Promise<Availability> {
    if (typeof LanguageModel === "undefined" || !LanguageModel) return "unavailable";
    try {
      const a = await LanguageModel.availability();
      if (a === "available") return "ready";
      if (a === "downloadable" || a === "downloading") return "downloadable";
    } catch {
      // fall through
    }
    return "unavailable";
  }

  async init(onProgress?: (p: number) => void): Promise<void> {
    if (this.session) return;
    if (typeof LanguageModel === "undefined" || !LanguageModel) {
      throw new Error("Prompt API not available in this browser");
    }
    this.session = await LanguageModel.create({
      initialPrompts: [{ role: "system", content: SYSTEM_PROMPT }],
      monitor: onProgress
        ? (m) => {
            m.addEventListener("downloadprogress", (e) => {
              const ev = e as Event & { loaded?: number };
              onProgress(ev.loaded ?? 0);
            });
          }
        : undefined,
    });
  }

  async extract(chunk: string, ctx: ChunkContext): Promise<ExtractionResult> {
    if (!this.session) await this.init();
    const base = this.session;
    if (!base) throw new Error("Prompt API session failed to initialize");

    // Fresh clone per chunk so per-chunk conversation doesn't eat the
    // context window (§11 "Nano context budget").
    const session = await base.clone();
    try {
      let prompt = buildUserPrompt(chunk, ctx);
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        const raw = await session.prompt(prompt, { responseConstraint: EXTRACTION_SCHEMA });
        const parsed = parseExtraction(raw);
        if (parsed) return parsed;
        prompt = RETRY_PROMPT;
      }
      throw new Error(`chunk ${ctx.index}: no valid JSON after ${MAX_RETRIES + 1} attempts`);
    } finally {
      session.destroy();
    }
  }

  async dispose(): Promise<void> {
    this.session?.destroy();
    this.session = null;
  }
}
