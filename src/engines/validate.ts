/**
 * Validate-and-repair for engine output (BUILD_PLAN §8, §11).
 * Nano's constrained output is not fully reliable: parse defensively,
 * keep well-formed propositions, drop malformed ones.
 */

import type { EntityMention, EntityType, ExtractionResult, Proposition } from "../core/types";

const ENTITY_TYPES = new Set<EntityType>([
  "person",
  "organization",
  "location",
  "concept",
  "event",
  "artifact",
  "quantity",
  "time",
  "other",
]);

function asMention(value: unknown): EntityMention | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.name !== "string" || v.name.trim() === "") return null;
  const type = ENTITY_TYPES.has(v.type as EntityType) ? (v.type as EntityType) : "other";
  return { name: v.name.trim(), type };
}

function asProposition(value: unknown, index: number): Proposition | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  const subject = asMention(v.subject);
  const object = asMention(v.object);
  if (!subject || !object) return null;
  if (typeof v.text !== "string" || v.text.trim() === "") return null;
  if (typeof v.predicate !== "string" || v.predicate.trim() === "") return null;
  const p: Proposition = {
    id: typeof v.id === "string" && v.id ? v.id : `p${index + 1}`,
    text: v.text.trim(),
    subject,
    predicate: v.predicate.trim(),
    object,
  };
  if (typeof v.confidence === "number" && v.confidence >= 0 && v.confidence <= 1) {
    p.confidence = v.confidence;
  }
  return p;
}

/**
 * Parse raw model output into an ExtractionResult.
 * Returns null when the payload is unusable (triggers a retry upstream).
 */
export function parseExtraction(raw: string): ExtractionResult | null {
  // Models occasionally wrap JSON in markdown fences or prose — dig it out.
  const text = raw.trim();
  const candidate = text.startsWith("{") ? text : text.match(/\{[\s\S]*\}/)?.[0];
  if (!candidate) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const propositions = (parsed as Record<string, unknown>).propositions;
  if (!Array.isArray(propositions)) return null;
  return {
    propositions: propositions
      .map((p, i) => asProposition(p, i))
      .filter((p): p is Proposition => p !== null),
  };
}
