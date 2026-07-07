/**
 * WebLLMEngine (BUILD_PLAN §8, M5): in-browser inference via @mlc-ai/web-llm.
 * Grammar-constrained JSON output (XGrammar), so parse failures are rare —
 * but everything still goes through parseExtraction like any engine.
 *
 * The library is dynamically imported so the ~500 kB runtime never loads
 * unless the user actually picks this engine. Model weights download once
 * (§1a consent screen owns that decision) and cache in browser storage.
 */

import type { Availability, ChunkContext, ExtractionEngine, ExtractionResult } from "../core/types";
import { buildUserPrompt, RETRY_PROMPT, SYSTEM_PROMPT } from "./prompt";
import { EXTRACTION_SCHEMA } from "./schema";
import { parseExtraction } from "./validate";

export interface WebLLMModelOption {
  id: string;
  label: string;
  /** approximate one-time download, GB (4-bit weights) */
  sizeGB: number;
  /** approximate VRAM needed at runtime, GB */
  vramGB: number;
}

/** Capped at 3B/4-bit per §11 — 7B lives at the edge of the ~4 GB/tab VRAM cap. */
export const WEBLLM_MODELS: WebLLMModelOption[] = [
  { id: "Qwen2.5-0.5B-Instruct-q4f16_1-MLC", label: "Qwen 2.5 — 0.5B", sizeGB: 0.4, vramGB: 1 },
  { id: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC", label: "Qwen 2.5 — 1.5B", sizeGB: 0.9, vramGB: 2 },
  { id: "Qwen2.5-3B-Instruct-q4f16_1-MLC", label: "Qwen 2.5 — 3B", sizeGB: 1.8, vramGB: 3.5 },
];

export const DEFAULT_WEBLLM_MODEL = "Qwen2.5-3B-Instruct-q4f16_1-MLC";

const MAX_RETRIES = 2;

export function hasWebGPU(): boolean {
  return typeof navigator !== "undefined" && "gpu" in navigator;
}

export async function isModelCached(modelId: string): Promise<boolean> {
  if (!hasWebGPU()) return false;
  try {
    const { hasModelInCache } = await import("@mlc-ai/web-llm");
    return await hasModelInCache(modelId);
  } catch {
    return false;
  }
}

/** Free browser-storage estimate in GB, or null when the API is unavailable. */
export async function freeStorageGB(): Promise<number | null> {
  try {
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    return quota > 0 ? (quota - usage) / 1024 ** 3 : null;
  } catch {
    return null;
  }
}

type MLCEngine = Awaited<ReturnType<typeof import("@mlc-ai/web-llm")["CreateMLCEngine"]>>;

export class WebLLMEngine implements ExtractionEngine {
  readonly id = "webllm" as const;
  readonly model: string;
  private engine: MLCEngine | null = null;

  constructor(modelId: string = DEFAULT_WEBLLM_MODEL) {
    this.model = modelId;
  }

  async isAvailable(): Promise<Availability> {
    if (!hasWebGPU()) return "unavailable";
    return (await isModelCached(this.model)) ? "ready" : "downloadable";
  }

  async init(onProgress?: (p: number) => void): Promise<void> {
    if (this.engine) return;
    const { CreateMLCEngine } = await import("@mlc-ai/web-llm");
    this.engine = await CreateMLCEngine(this.model, {
      initProgressCallback: (report) => onProgress?.(report.progress ?? 0),
    });
  }

  async extract(chunk: string, ctx: ChunkContext): Promise<ExtractionResult> {
    if (!this.engine) await this.init();
    const engine = this.engine;
    if (!engine) throw new Error("WebLLM engine failed to initialize");

    const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt(chunk, ctx) },
    ];
    let lastRaw = "";
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const reply = await engine.chat.completions.create({
        messages,
        temperature: 0,
        response_format: { type: "json_object", schema: JSON.stringify(EXTRACTION_SCHEMA) },
      });
      const raw = reply.choices[0]?.message?.content ?? "";
      lastRaw = raw;
      const parsed = parseExtraction(raw);
      if (parsed) return parsed;
      messages.push({ role: "assistant", content: raw }, { role: "user", content: RETRY_PROMPT });
    }
    throw new Error(
      `chunk ${ctx.index}: no valid JSON after ${MAX_RETRIES + 1} attempts: ${lastRaw.slice(0, 120)}`,
    );
  }

  async dispose(): Promise<void> {
    await this.engine?.unload();
    this.engine = null;
  }
}
