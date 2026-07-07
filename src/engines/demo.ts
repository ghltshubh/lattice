/**
 * DemoEngine — the M0 stub implementation of ExtractionEngine.
 * Returns canned propositions (clearly labeled in the UI) so the full
 * pipeline — resolution, dedup, scoring, rendering, export — can be
 * exercised end-to-end in any browser, with no model available.
 */

import type {
  Availability,
  ChunkContext,
  ExtractionEngine,
  ExtractionResult,
  Proposition,
} from "../core/types";

const SCRIPTS: Proposition[][] = [
  [
    {
      id: "p1",
      text: "Lattice is a client-side web application.",
      subject: { name: "Lattice", type: "artifact" },
      predicate: "is",
      object: { name: "client-side web application", type: "concept" },
    },
    {
      id: "p2",
      text: "Lattice decomposes documents into atomic propositions.",
      subject: { name: "Lattice", type: "artifact" },
      predicate: "decomposes documents into",
      object: { name: "atomic propositions", type: "concept" },
    },
    {
      id: "p3",
      text: "Lattice assembles atomic propositions into a knowledge graph.",
      subject: { name: "Lattice", type: "artifact" },
      predicate: "assembles propositions into",
      object: { name: "knowledge graph", type: "concept" },
    },
  ],
  [
    {
      id: "p1",
      text: "The Lattice app renders the knowledge graph with Sigma.js.",
      subject: { name: "the Lattice app", type: "artifact" },
      predicate: "renders graph with",
      object: { name: "Sigma.js", type: "artifact" },
    },
    {
      id: "p2",
      text: "Gemini Nano extracts propositions inside Chrome.",
      subject: { name: "Gemini Nano", type: "artifact" },
      predicate: "extracts propositions inside",
      object: { name: "Chrome", type: "artifact" },
    },
    {
      id: "p3",
      text: "The knowledge graph traces every edge back to supporting claims.",
      subject: { name: "knowledge graph", type: "concept" },
      predicate: "traces edges back to",
      object: { name: "supporting claims", type: "concept" },
    },
  ],
];

export class DemoEngine implements ExtractionEngine {
  readonly id = "demo" as const;
  readonly model = "canned output (no model)";

  async isAvailable(): Promise<Availability> {
    return "ready";
  }

  async init(): Promise<void> {}

  async extract(_chunk: string, ctx: ChunkContext): Promise<ExtractionResult> {
    return { propositions: SCRIPTS[ctx.index % SCRIPTS.length] };
  }

  async dispose(): Promise<void> {}
}

/** Sample input for the paste box — pairs with a real engine for a quick demo. */
export const SAMPLE_TEXT = `Marie Curie was born in Warsaw in 1867. She moved to Paris to study physics at the Sorbonne, where she met Pierre Curie. Marie and Pierre Curie discovered polonium and radium in 1898.

Marie Curie won the Nobel Prize in Physics in 1903, sharing it with Pierre Curie and Henri Becquerel. After Pierre's death, she took over his professorship at the Sorbonne, becoming the first woman to teach there. In 1911 she won a second Nobel Prize, this time in Chemistry, for her work on radium.

During the First World War, Marie Curie developed mobile radiography units to provide X-ray services to field hospitals. Her daughter Irène Joliot-Curie later won a Nobel Prize in Chemistry as well.`;
