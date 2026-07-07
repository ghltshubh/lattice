/**
 * Engine registry. The UI depends only on ExtractionEngine (BUILD_PLAN §8) —
 * WebLLM (M5) slots in here later without touching the pipeline or UI.
 */

import type { Availability, EngineId, ExtractionEngine } from "../core/types";
import { DemoEngine } from "./demo";
import { PromptApiEngine } from "./prompt-api";

export function createEngine(id: EngineId): ExtractionEngine {
  switch (id) {
    case "prompt-api":
      return new PromptApiEngine();
    case "demo":
      return new DemoEngine();
    case "webllm":
      throw new Error("WebLLM engine lands at milestone M5");
  }
}

export const SELECTABLE_ENGINES: EngineId[] = ["prompt-api", "demo"];

export async function checkAvailability(): Promise<Record<string, Availability>> {
  const out: Record<string, Availability> = {};
  for (const id of SELECTABLE_ENGINES) {
    out[id] = await createEngine(id).isAvailable();
  }
  return out;
}
