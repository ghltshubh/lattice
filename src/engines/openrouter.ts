/**
 * OpenRouterEngine (BUILD_PLAN §8, M7): the High-quality cloud mode.
 * BYOK — the user's key goes browser → openrouter.ai directly and NOWHERE
 * else (§11 "cloud-mode trust"); there is no Lattice server in the path.
 * Selecting this mode is an explicit, warned opt-in (§1a): document text
 * leaves the device.
 */

import type { Availability, ChunkContext, ExtractionEngine, ExtractionResult } from "../core/types";
import { buildUserPrompt, RETRY_PROMPT, SYSTEM_PROMPT } from "./prompt";
import { EXTRACTION_SCHEMA } from "./schema";
import { parseExtraction } from "./validate";

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const MAX_RETRIES = 2;

/** Editable in the UI — any OpenRouter model id works; this is just a sane cheap default. */
export const DEFAULT_OPENROUTER_MODEL = "openai/gpt-4o-mini";

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export class OpenRouterEngine implements ExtractionEngine {
  readonly id = "openrouter" as const;
  readonly model: string;
  private readonly key: string;

  constructor(key: string, model: string = DEFAULT_OPENROUTER_MODEL) {
    this.key = key.trim();
    this.model = model.trim() || DEFAULT_OPENROUTER_MODEL;
  }

  async isAvailable(): Promise<Availability> {
    return this.key ? "ready" : "unavailable";
  }

  async init(): Promise<void> {
    if (!this.key) throw new Error("OpenRouter API key missing");
  }

  private async complete(messages: ChatMessage[]): Promise<string> {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.key}`,
        "Content-Type": "application/json",
        "X-Title": "Lattice",
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        temperature: 0,
        response_format: {
          type: "json_schema",
          json_schema: { name: "extraction", strict: true, schema: EXTRACTION_SCHEMA },
        },
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      if (res.status === 401) throw new Error("OpenRouter rejected the API key (401)");
      if (res.status === 402) throw new Error("OpenRouter: insufficient credits (402)");
      if (res.status === 429) throw new Error("OpenRouter: rate limited (429) — try again shortly");
      throw new Error(`OpenRouter error ${res.status}: ${detail.slice(0, 160)}`);
    }
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    return data.choices?.[0]?.message?.content ?? "";
  }

  async extract(chunk: string, ctx: ChunkContext): Promise<ExtractionResult> {
    const messages: ChatMessage[] = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt(chunk, ctx) },
    ];
    let lastRaw = "";
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const raw = await this.complete(messages);
      lastRaw = raw;
      const parsed = parseExtraction(raw);
      if (parsed) return parsed;
      messages.push({ role: "assistant", content: raw }, { role: "user", content: RETRY_PROMPT });
    }
    throw new Error(
      `chunk ${ctx.index}: no valid JSON after ${MAX_RETRIES + 1} attempts: ${lastRaw.slice(0, 120)}`,
    );
  }

  async dispose(): Promise<void> {}
}
