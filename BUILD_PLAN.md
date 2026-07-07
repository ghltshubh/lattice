# Lattice — Build Plan

> Working codename: **Lattice** (a client-side webapp that decomposes text/documents into atomic propositions and assembles a knowledge graph). Rename freely.

A standalone, no-hosting single-page web application. All parsing, inference, graph assembly, and rendering run on the user's device. No server, no API keys, no data leaves the browser.

---

## 1. Locked decisions

| Decision | Choice | Rationale |
|---|---|---|
| Deployment | Static SPA, no backend | Fully client-side; deploy as static files or open `index.html` |
| Inference | **Dual-engine**: Prompt API (default) + WebLLM (opt-in) | Zero-wait start; opt-in quality upgrade with one-time download |
| Engine seam | Single `ExtractionEngine` interface | Prompt-API-only is a valid M1 subset; WebLLM slots in at M5 |
| Input ceiling | Medium — up to ~10 pages (~7–8k tokens) | Keeps chunk counts and entity counts modest |
| Atomic unit | Self-contained **proposition** (single claim, no pronouns) | Maps cleanly to (subject, predicate, object); avoids tag-cloud failure mode |
| UI | React + Vite + TS; pipeline layer is framework-agnostic pure TS | UI has several stateful panels; keep core portable |
| Graph model + render | `graphology` (model + metrics) + **Sigma.js** (WebGL render) | Free degree/PageRank/layout; scales past hairball territory |
| Persistence | IndexedDB (`idb`) | Model cache + saved graphs, survives reloads |

**Swappable without touching the plan:** Sigma.js ↔ react-force-graph (faster to prototype, weaker at large graphs); React ↔ vanilla (core is framework-agnostic either way).

---

## 2. Pipeline overview

```
Document/Text
   │  ingest & parse   (pdf.js / mammoth / native)
   ▼
Plain text
   │  chunk            (semantic-ish, overlap for coreference)
   ▼
Chunks[]
   │  extract          (ExtractionEngine → ExtractionResult per chunk)
   ▼
Proposition[] (per chunk, with subject/predicate/object)
   │  resolve & merge  (normalize → exact → embedding fuzzy → union-find)
   ▼
KnowledgeGraph (canonical nodes, deduped weighted edges, provenance)
   │  score            (degree, PageRank via graphology-metrics)
   ▼
Render (Sigma.js) + Persist (IndexedDB) + Export (JSON / GraphML)
```

The LLM call is the *easy* stage. The quality bottleneck is **cross-chunk entity resolution** (§6). Budget effort there, not on prompt-wrangling.

---

## 3. Output contract (types)

The contract is the heart of the system. Everything downstream depends on these shapes.

```ts
// ---------- Entity taxonomy (LLM-classified, open-ish) ----------
export type EntityType =
  | "person" | "organization" | "location" | "concept"
  | "event"  | "artifact"     | "quantity" | "time" | "other";

// ---------- Per-chunk extraction (what an engine returns) ----------
export interface EntityMention {
  name: string;        // model-normalized surface form (full name on first mention)
  type: EntityType;    // model classifies; do not hardcode a taxonomy upstream
}

export interface Proposition {
  id: string;          // local to chunk, e.g. "p1"
  text: string;        // ONE self-contained claim, pronouns resolved
  subject: EntityMention;
  predicate: string;   // concise normalized verb phrase, one relation
  object: EntityMention;
  confidence?: number; // 0–1, OPTIONAL — omit rather than guess (see §5)
}

export interface ExtractionResult {
  propositions: Proposition[];   // empty array is a valid, correct answer
}

// ---------- Merged global graph ----------
export interface GraphNode {
  id: string;          // canonical id after resolution
  label: string;       // canonical display name
  type: EntityType;
  aliases: string[];   // all surface forms merged into this node
  mentions: number;    // frequency → node size
  degree: number;      // computed
  rank: number;        // PageRank → layout weight / prominence
  sourceChunks: number[];
}

export interface GraphEdge {
  id: string;
  source: string;      // node id
  target: string;      // node id
  label: string;       // predicate
  weight: number;      // # supporting propositions
  propositions: string[]; // PROVENANCE: global proposition ids behind this edge
}

export interface GraphMeta {
  title?: string;
  createdAt: string;
  engine: "prompt-api" | "webllm";
  model: string;
  chunkCount: number;
  tokenEstimate: number;
}

export interface KnowledgeGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  meta: GraphMeta;
}
```

**Provenance is a feature, not bookkeeping.** Every edge traces back to the atomic propositions that produced it. In the UI, clicking an edge shows the exact claims — this is what makes the graph trustworthy instead of a pile of confident guesses.

---

## 4. Extraction schema (`responseConstraint` / WebLLM `json_schema`)

Same JSON Schema drives both engines. Keep it flat and small — on Prompt API the schema itself consumes context budget.

```json
{
  "type": "object",
  "properties": {
    "propositions": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id":   { "type": "string" },
          "text": { "type": "string" },
          "subject": {
            "type": "object",
            "properties": {
              "name": { "type": "string" },
              "type": { "type": "string",
                "enum": ["person","organization","location","concept",
                         "event","artifact","quantity","time","other"] }
            },
            "required": ["name","type"]
          },
          "predicate": { "type": "string" },
          "object": {
            "type": "object",
            "properties": {
              "name": { "type": "string" },
              "type": { "type": "string",
                "enum": ["person","organization","location","concept",
                         "event","artifact","quantity","time","other"] }
            },
            "required": ["name","type"]
          }
        },
        "required": ["id","text","subject","predicate","object"]
      }
    }
  },
  "required": ["propositions"]
}
```

`confidence` is intentionally omitted from `required` — models should skip it rather than fabricate a number.

---

## 5. System prompt strategy

Single-pass extraction per chunk (no separate decompose→triple round; the weaker engine can't afford double calls). Encode these rules in the system prompt:

1. **Atomic** — each proposition states exactly one claim. Split compound sentences.
2. **Self-contained** — resolve every pronoun and reference using the surrounding text. No "he", "it", "the company" as an entity name.
3. **Canonicalize names** — use the fullest form seen (e.g. "reconciliation loop" not "the loop"); strip leading articles.
4. **One predicate** — the predicate is a short verb phrase describing a single relation.
5. **Classify type** — pick the entity type from the enum; use `other` when unsure, never invent.
6. **Omit over hallucinate** — if a chunk contains no extractable factual relation, return `{"propositions": []}`. An empty result is correct and expected; a fabricated edge is a failure.

> This mirrors the two principles that already worked in Lens: *omission over hallucination* for weak signals, and *let the model classify* rather than imposing a rigid taxonomy at the call site.

Provide 1–2 few-shot examples in the prompt (a short passage → its propositions), including one example that correctly returns an empty array. Few-shot matters far more on Nano than on WebLLM.

---

## 6. Cross-chunk entity resolution (the hard part)

Goal: "the reconciliation loop", "reconciliation", and "the loop" collapse to one node — without merging genuinely distinct entities.

At the ~10-page ceiling, entity counts are dozens to low-hundreds, so **O(n²) pairwise comparison is fine** — no ANN index needed.

**Algorithm:**

1. **Collect** every `EntityMention` across all chunks; assign each a global proposition provenance.
2. **Normalize key** — lowercase, strip articles/punctuation/extra whitespace → `normKey`.
3. **Exact merge** — identical `normKey` **and** same `type` → same cluster.
4. **Embedding fuzzy merge** — embed each surviving surface form with a small Transformers.js model (`all-MiniLM-L6-v2` / `bge-small-en` / `gte-small`, WebGPU with WASM fallback). Merge pair when `cosine ≥ 0.83` **and** same `type`. (Tune threshold empirically; expose as a dev setting.)
5. **(WebLLM only) LLM adjudication** — for borderline pairs (0.78–0.83), batch-ask the active LLM "same entity? yes/no". Skip entirely on Prompt-API-only builds.
6. **Cluster** with union-find; pick canonical label = most frequent surface form (ties → longest). All other forms become `aliases`.
7. **Rebuild edges** against canonical node ids. Dedupe parallel edges by `(source, predicate, target)`: accumulate `weight`, union `propositions`.

**Fallback if no embeddings available** (locked-down GPU + WASM too slow): exact merge + Jaro-Winkler string similarity ≥ 0.92. Lower recall, still ships.

**Then score:** `degree` and `rank` (PageRank) via `graphology-metrics`; feed `mentions`→node size and `rank`→prominence into the layout.

---

## 7. Chunking

- Target **~900 tokens/chunk, ~120 token overlap**. Overlap is what carries coreference across boundaries.
- Prefer paragraph/heading boundaries over hard cuts (regex split on double newline / headings, then pack).
- Token estimate: `chars / 4` heuristic for guardrails; on Prompt API use `session.measureInputUsage()` / `contextUsage` to stay under budget (remember the schema eats into the window).
- **10-page guardrail:** if `tokenEstimate > ~9k`, warn and offer to truncate or proceed chunk-by-chunk. Hard cap configurable.

---

## 8. Engine abstraction

```ts
export type Availability = "ready" | "downloadable" | "unavailable";

export interface ChunkContext {
  index: number;
  docTitle?: string;
  priorEntities?: string[];   // optional carry-over to aid coreference
}

export interface ExtractionEngine {
  readonly id: "prompt-api" | "webllm";
  isAvailable(): Promise<Availability>;
  init(onProgress?: (p: number) => void): Promise<void>; // download/load
  extract(chunk: string, ctx: ChunkContext): Promise<ExtractionResult>;
  dispose(): Promise<void>;
}
```

**`PromptApiEngine`** — `LanguageModel.create()` + `prompt(..., { responseConstraint: schema })`. Because Nano's constrained output is not fully reliable, wrap in **validate-and-retry**: `JSON.parse` in try/catch → on failure, re-prompt "return only valid JSON matching the schema" → cap at 2 retries → drop the chunk (log it) on repeated failure. Check `LanguageModel.availability()` before init.

**`WebLLMEngine`** — `CreateMLCEngine(model, { initProgressCallback })`; OpenAI-style call with `response_format: { type: "json_schema", ... }` (grammar-constrained via XGrammar, so parse failures are rare). Default opt-in model capped at **3B, 4-bit** to stay under the ~4GB-per-tab VRAM ceiling. Weights cache in IndexedDB after first download.

The UI depends only on `ExtractionEngine`. That seam is what makes a Prompt-API-only first cut a one-line engine swap.

---

## 9. Milestones

Each milestone ends in a demoable, acceptance-testable state.

### M0 — Skeleton
Vite React-TS app, folder layout (`/core` pipeline, `/engines`, `/ui`), `ExtractionEngine` interface + stub impls, IndexedDB wrapper, empty graph canvas, paste-text box.
**Accept:** app boots; paste text → runs an end-to-end no-op path without errors.

### M1 — Prompt API extraction (default engine)
`PromptApiEngine` with the §4 schema, §5 prompt, single-chunk extraction, validate-and-retry.
**Accept:** paste a paragraph → valid `ExtractionResult`; a filler sentence → `{propositions: []}`.

### M2 — Ingest & chunking
pdf.js + mammoth + txt/md ingest; chunker with overlap; token estimate; 10-page guardrail.
**Accept:** upload a 10-page PDF → chunks produced, each within token budget; guardrail fires past the cap.

### M3 — Graph assembly + resolution
Cross-chunk merge (exact + embedding fuzzy via Transformers.js), edge dedupe, degree + PageRank.
**Accept:** a multi-chunk doc yields a merged graph with no obvious duplicate nodes; every edge carries provenance; aliases populated.

### M4 — Visualization
Sigma.js render: node size by `mentions`, color by `type`, click node → highlight neighbors, click edge → provenance panel listing supporting propositions.
**Accept:** interactive graph; edge provenance visible; layout readable at ~100 nodes.

### M5 — WebLLM opt-in engine
`WebLLMEngine` behind the same interface; model picker (0.5B / 1.5B / 3B); lazy download on first toggle with progress bar; cached thereafter; engine toggle in UI.
**Accept:** flip to WebLLM → one-time download w/ progress → extraction quality visibly cleaner → reload uses cache, no re-download.

### M6 — Persist & export
Save/load graphs to IndexedDB; export JSON + GraphML; export canvas as PNG/SVG.
**Accept:** save → reload page → restore graph; GraphML opens in Gephi.

---

## 10. Suggested stack & packages

> Version pins below are **best-guess placeholders** — validate the current version on npm at build time (same discipline as the Lens plan; don't trust a stale pin).

- Build: `vite`, `typescript`, `@vitejs/plugin-react`, `biome`
- Engines: `@mlc-ai/web-llm`, `@huggingface/transformers`, `@types/dom-chromium-ai`
- Ingest: `pdfjs-dist`, `mammoth`
- Graph: `graphology`, `graphology-metrics` (PageRank/degree), `graphology-layout-forceatlas2`, `sigma`
- Storage: `idb`
- (Alt render) `react-force-graph-2d` if you prefer speed-to-interactive over scale

Embedding model: `Xenova/all-MiniLM-L6-v2` (~30–90 MB, cached) or a `bge-small`/`gte-small` ONNX build.

---

## 11. Known flags & risks

- **Nano JSON reliability** — constrained output isn't fully guaranteed; validate-and-retry, cap retries, drop-and-log on failure.
- **Nano context budget** — the schema in the prompt shrinks the usable window; keep schema flat, chunks modest.
- **Availability gating** — Prompt API is Chrome-desktop + hardware-gated; WebGPU is broad but not universal. Capability-check both on load and show a clear message + which engines are usable.
- **VRAM ceiling** — cap the default WebLLM opt-in at 3B/4-bit; 7B lives at the edge of the ~4GB/tab cap and gets flaky.
- **Embedding download** — small but nonzero (~30–90 MB) the first time resolution runs; lazy-load it, show a tiny progress note.
- **Resolution threshold** — 0.83 cosine is a starting point; expose as a dev setting and tune on real docs. Over-merging is worse than under-merging for trust.
- **Version drift** — validate every package version at build; Nano and WebLLM both move fast.

---

## 12. First-cut option (if scoping tighter)

Ship **M0–M4 on Prompt-API-only** as v0.1 (no download, instant, Chrome-desktop). Because everything sits behind `ExtractionEngine`, adding WebLLM (M5) later is additive, not a rewrite. This is the recommended path if you want something usable in front of people fast before committing to the dual-engine surface area.
