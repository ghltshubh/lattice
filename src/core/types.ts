/**
 * Lattice — output contract (BUILD_PLAN §3) and engine seam (§8).
 * Everything downstream depends on these shapes.
 */

// ---------- Entity taxonomy (LLM-classified, open-ish) ----------
export type EntityType =
  | "person"
  | "organization"
  | "location"
  | "concept"
  | "event"
  | "artifact"
  | "quantity"
  | "time"
  | "other";

// ---------- Per-chunk extraction (what an engine returns) ----------
export interface EntityMention {
  name: string; // model-normalized surface form (full name on first mention)
  type: EntityType; // model classifies; do not hardcode a taxonomy upstream
}

export interface Proposition {
  id: string; // local to chunk, e.g. "p1"
  text: string; // ONE self-contained claim, pronouns resolved
  subject: EntityMention;
  predicate: string; // concise normalized verb phrase, one relation
  object: EntityMention;
  confidence?: number; // 0–1, OPTIONAL — omit rather than guess (§5)
}

export interface ExtractionResult {
  propositions: Proposition[]; // empty array is a valid, correct answer
}

// ---------- Merged global graph ----------
export interface GraphNode {
  id: string; // canonical id after resolution
  label: string; // canonical display name
  type: EntityType;
  aliases: string[]; // all surface forms merged into this node
  mentions: number; // frequency → node size
  degree: number; // computed
  rank: number; // PageRank → layout weight / prominence
  sourceChunks: number[];
}

export interface GraphEdge {
  id: string;
  source: string; // node id
  target: string; // node id
  label: string; // predicate
  weight: number; // # supporting propositions
  propositions: string[]; // PROVENANCE: global proposition ids behind this edge
}

export interface GraphMeta {
  title?: string;
  createdAt: string;
  engine: EngineId;
  model: string;
  chunkCount: number;
  tokenEstimate: number;
}

/** Proposition text carried on the graph so provenance is displayable/exportable. */
export interface PropositionRecord {
  id: string; // global id
  text: string;
  sourceChunk?: number;
}

export interface KnowledgeGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  meta: GraphMeta;
  propositions?: PropositionRecord[];
}

// ---------- Engine abstraction (§8) ----------
export type EngineId = "prompt-api" | "webllm" | "openrouter";

/** UI mode (§1a): maps to engines in the registry, never hardwired. */
export type InferenceMode = "private" | "quality";

export type Availability = "ready" | "downloadable" | "unavailable";

export interface ChunkContext {
  index: number;
  docTitle?: string;
  priorEntities?: string[]; // optional carry-over to aid coreference
}

export interface ExtractionEngine {
  readonly id: EngineId;
  readonly model: string;
  isAvailable(): Promise<Availability>;
  init(onProgress?: (p: number) => void): Promise<void>; // download/load
  extract(chunk: string, ctx: ChunkContext): Promise<ExtractionResult>;
  dispose(): Promise<void>;
}

// ---------- Chunking ----------
export interface Chunk {
  index: number;
  text: string;
  tokenEstimate: number;
}
