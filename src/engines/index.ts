/**
 * Engine registry. The UI depends only on ExtractionEngine (BUILD_PLAN §8);
 * mode → engine mapping happens here so neither the pipeline nor the UI
 * hardwires an engine. OpenRouter (M7) slots in the same way.
 */

import type { Availability, EngineId, ExtractionEngine } from "../core/types";
import { OpenRouterEngine } from "./openrouter";
import { PromptApiEngine } from "./prompt-api";
import { WebLLMEngine } from "./webllm";

export interface EngineOptions {
  webllmModel?: string;
  openrouterKey?: string;
  openrouterModel?: string;
}

export function createEngine(id: EngineId, options: EngineOptions = {}): ExtractionEngine {
  switch (id) {
    case "prompt-api":
      return new PromptApiEngine();
    case "webllm":
      return new WebLLMEngine(options.webllmModel);
    case "openrouter":
      return new OpenRouterEngine(options.openrouterKey ?? "", options.openrouterModel);
  }
}

export async function checkAvailability(
  options: EngineOptions = {},
): Promise<Record<string, Availability>> {
  const out: Record<string, Availability> = {};
  for (const id of ["prompt-api", "webllm"] as const) {
    out[id] = await createEngine(id, options).isAvailable();
  }
  return out;
}

/** Private mode picks the best on-device engine: Nano when present, else WebLLM. */
export function privateEngineId(availability: Record<string, Availability>): EngineId {
  return availability["prompt-api"] !== "unavailable" ? "prompt-api" : "webllm";
}
