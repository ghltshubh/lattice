# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Lattice is a fully client-side single-page web app that decomposes documents into atomic propositions (subject–predicate–object claims) and assembles them into an interactive knowledge graph. **Hard constraint: no backend, no API keys, no document data ever leaves the device.** All parsing, LLM inference, entity resolution, and rendering run in the browser. Never introduce a server, hosted-LLM API call, or telemetry.

`BUILD_PLAN.md` is the design source of truth (data contracts, pipeline stages, milestones M0–M6, acceptance criteria). The types contract in §3 is canonical and lives at `src/core/types.ts`.

## Commands

bun is the package manager — not npm, despite what BUILD_PLAN.md implies.

- `bun run dev` / `bun run build` / `bun run preview`
- `bun run test` (vitest) — single file: `bunx vitest run src/core/resolve.test.ts`
- `bun run lint` / `bun run format` (Biome; config in biome.json)

## Architecture

- `src/core/` — framework-agnostic pure-TS pipeline (chunk → extract → resolve → assemble → score → persist/export). No React imports here.
- `src/engines/` — `ExtractionEngine` implementations (Prompt API today; WebLLM lands at M5). The UI and pipeline depend only on the interface in `src/core/types.ts`; never hardwire a specific engine.
- `src/ui/` — React components. Vite + React 19, Sigma.js for rendering.

Milestone state: M0–M4 done plus persistence/export (M6). Remaining: M5 (WebLLM opt-in engine), M6 PNG/SVG canvas export.

## Gotchas

- **Sigma reserves the node attribute `type`** for its render program — entity taxonomy goes under `entityType` in graphology attributes (see `toGraphology` in `src/core/graph.ts`). Violating this crashes the renderer with "could not find a suitable program".
- Chrome Prompt API types are hand-written in `src/engines/chromium-ai.d.ts` (deliberately not `@types/dom-chromium-ai`, which lags the fast-moving API). Extend that file when using more of the API.
- Engine output is never trusted: everything goes through `parseExtraction` (validate-and-retry, drop-and-log). An empty propositions array is a *correct* extraction result, not an error.
- Entity resolution merges only within the same `EntityType`; cosine threshold 0.83 (embedder) / Jaro-Winkler 0.92 (fallback). Over-merging is worse than under-merging.
