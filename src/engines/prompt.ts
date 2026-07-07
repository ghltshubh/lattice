/**
 * System prompt strategy (BUILD_PLAN §5): single-pass extraction per chunk,
 * omission over hallucination, model classifies entity types.
 * Few-shot matters far more on Nano than on WebLLM — keep both examples.
 */

import type { ChunkContext } from "../core/types";

export const SYSTEM_PROMPT = `You extract atomic propositions from text and return them as JSON.

Rules:
1. ATOMIC — each proposition states exactly one claim. Split compound sentences.
2. SELF-CONTAINED — resolve every pronoun and reference using the surrounding text. Never use "he", "it", "they", or "the company" as an entity name.
3. CANONICALIZE — use the fullest name seen for each entity; strip leading articles.
4. ONE PREDICATE — a short verb phrase describing a single relation.
5. CLASSIFY — pick each entity's type from: person, organization, location, concept, event, artifact, quantity, time, other. Use "other" when unsure; never invent a type.
6. OMIT OVER HALLUCINATE — if the text contains no extractable factual relation, return {"propositions": []}. An empty list is a correct answer; a fabricated claim is a failure.

Example 1:
Text: "Marie Curie discovered polonium in 1898. She later won the Nobel Prize in Physics."
Output:
{"propositions":[
 {"id":"p1","text":"Marie Curie discovered polonium in 1898.","subject":{"name":"Marie Curie","type":"person"},"predicate":"discovered","object":{"name":"polonium","type":"artifact"}},
 {"id":"p2","text":"Marie Curie won the Nobel Prize in Physics.","subject":{"name":"Marie Curie","type":"person"},"predicate":"won","object":{"name":"Nobel Prize in Physics","type":"artifact"}}
]}

Example 2:
Text: "Well, that was quite something, wasn't it?"
Output:
{"propositions":[]}

Return ONLY valid JSON matching the schema. No commentary.`;

export function buildUserPrompt(chunk: string, ctx: ChunkContext): string {
  const parts: string[] = [];
  if (ctx.docTitle) parts.push(`Document: ${ctx.docTitle}`);
  if (ctx.priorEntities?.length) {
    parts.push(
      `Entities already seen earlier in this document (reuse these exact names when the text refers to them): ${ctx.priorEntities.join(", ")}`,
    );
  }
  parts.push(`Extract all atomic propositions from this text:\n\n${chunk}`);
  return parts.join("\n\n");
}

export const RETRY_PROMPT =
  'Your previous reply was not valid JSON for the required schema. Return ONLY a valid JSON object of the form {"propositions": [...]} — no prose, no markdown fences.';
