/**
 * Pipeline orchestrator (BUILD_PLAN §2):
 * text → chunk → extract per chunk → resolve & merge → score.
 * Failed chunks are dropped and reported, never fatal (§11).
 */

import { chunkText } from "./chunker";
import { getEmbedder } from "./embed";
import { assembleGraph, type ChunkExtraction } from "./graph";
import { estimateTokens } from "./tokens";
import type { ExtractionEngine, KnowledgeGraph } from "./types";

export interface PipelineCallbacks {
  onStage?: (message: string) => void;
  onChunk?: (done: number, total: number) => void;
}

export interface PipelineResult {
  graph: KnowledgeGraph;
  droppedChunks: number[];
  /** last per-chunk failure — the diagnosis when chunks were dropped */
  dropError?: string;
}

const PRIOR_ENTITY_CARRY = 20;

/** Model title replies arrive with quotes, newlines, or preamble spacing — normalize hard. */
export function sanitizeTitle(raw: string): string | undefined {
  const title = raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)[0]
    ?.replace(/^["'“”‘’#*\s]+|["'“”‘’.!*\s]+$/g, "")
    .slice(0, 80)
    .trim();
  return title || undefined;
}

export async function runPipeline(
  text: string,
  engine: ExtractionEngine,
  options: { title?: string; callbacks?: PipelineCallbacks } = {},
): Promise<PipelineResult> {
  const { onStage, onChunk } = options.callbacks ?? {};

  const chunks = chunkText(text);
  onStage?.(
    `Extracting propositions from ${chunks.length} chunk${chunks.length === 1 ? "" : "s"}…`,
  );

  const extractions: ChunkExtraction[] = [];
  const dropped: number[] = [];
  let dropError: string | undefined;
  const priorEntities: string[] = [];
  for (const chunk of chunks) {
    try {
      const result = await engine.extract(chunk.text, {
        index: chunk.index,
        docTitle: options.title,
        priorEntities: priorEntities.slice(-PRIOR_ENTITY_CARRY),
      });
      extractions.push({ chunkIndex: chunk.index, propositions: result.propositions });
      for (const p of result.propositions) {
        for (const name of [p.subject.name, p.object.name]) {
          if (!priorEntities.includes(name)) priorEntities.push(name);
        }
      }
    } catch (err) {
      console.warn(`Dropping chunk ${chunk.index}:`, err);
      dropped.push(chunk.index);
      dropError = err instanceof Error ? err.message : String(err);
    }
    onChunk?.(chunk.index + 1, chunks.length);
  }

  // Auto-title when the user left it blank; a failure here never blocks the run.
  let title = options.title;
  if (!title && engine.suggestTitle) {
    onStage?.("Naming the document…");
    try {
      title = sanitizeTitle(await engine.suggestTitle(text.slice(0, 4000)));
    } catch (err) {
      console.warn("Auto-title failed:", err);
    }
  }

  onStage?.("Resolving entities across chunks…");
  const embedder = await getEmbedder(onStage);

  const graph = await assembleGraph(
    extractions,
    {
      title,
      createdAt: new Date().toISOString(),
      engine: engine.id,
      model: engine.model,
      chunkCount: chunks.length,
      tokenEstimate: estimateTokens(text),
    },
    { embedder },
  );
  return { graph, droppedChunks: dropped, dropError };
}
