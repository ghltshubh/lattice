/**
 * Lattice — graph exporters
 * ---------------------------------------------------------------------------
 * Pure functions that turn a KnowledgeGraph into formats consumable by
 * knowledge systems. No framework deps. JSZip is dynamically imported only
 * when zipping an Obsidian vault, so the rest of the module has zero deps.
 *
 * Formats:
 *   - Portable JSON  (.json)      → neutral interchange for custom systems
 *   - JSON Canvas    (.canvas)    → opens natively as an Obsidian Canvas
 *   - Obsidian vault (folder .md) → notes + wikilinks → Obsidian Graph View
 *   - Cytoscape.js   (.cyjs.json) → other graph-viz tools
 *   - GraphML        (.graphml)   → Gephi / yEd
 */

import type { EntityType, GraphNode, KnowledgeGraph } from "./types";

/**
 * CONTRACT ADDITION (recommended — small extension to BUILD_PLAN §3):
 * To export provenance ("supporting claims"), the graph needs the proposition
 * TEXT, not just the ids that GraphEdge.propositions already holds. Add:
 *
 *   interface KnowledgeGraph { propositions?: PropositionRecord[]; }
 *
 * If absent, exporters silently omit the supporting-claims sections.
 */
export interface PropositionRecord {
  id: string;
  text: string;
  sourceChunk?: number;
}
export type ExportableGraph = KnowledgeGraph & {
  propositions?: PropositionRecord[];
};

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Hex palette by entity type (JSON Canvas + feeds Sigma rendering too). */
export const TYPE_COLOR: Record<EntityType, string> = {
  person: "#e06c75",
  organization: "#61afef",
  location: "#98c379",
  concept: "#c678dd",
  event: "#e5c07b",
  artifact: "#56b6c2",
  quantity: "#d19a66",
  time: "#8aa2c8",
  other: "#7f848e",
};

function propLookup(graph: ExportableGraph): Record<string, string> {
  const lut: Record<string, string> = {};
  for (const p of graph.propositions ?? []) lut[p.id] = p.text;
  return lut;
}

function xml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function yamlStr(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function slugTitle(graph: ExportableGraph): string {
  return (graph.meta?.title || "graph").replace(/[\\/:*?"<>|]/g, "_").trim() || "graph";
}

// ---------------------------------------------------------------------------
// 1. Portable JSON — neutral interchange
// ---------------------------------------------------------------------------

export function toPortableJSON(graph: ExportableGraph): string {
  return JSON.stringify({ format: "lattice.graph", version: 1, ...graph }, null, 2);
}

// ---------------------------------------------------------------------------
// 2. JSON Canvas — opens natively in Obsidian Canvas (.canvas)
//    Spec: https://jsoncanvas.org/spec/1.0/
// ---------------------------------------------------------------------------

export interface CanvasOptions {
  /** nearest-neighbour spacing for the auto layout */
  spacing?: number;
  /** supply real layout coords (e.g. from graphology) to override auto layout */
  positions?: Record<string, { x: number; y: number }>;
}

export function toJSONCanvas(graph: ExportableGraph, opts: CanvasOptions = {}): string {
  const spacing = opts.spacing ?? 340;
  // Important nodes (high rank) go first → placed near the centre of the spiral.
  const ordered = [...graph.nodes].sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0));
  const pos =
    opts.positions ??
    phyllotaxis(
      ordered.map((n) => n.id),
      spacing,
    );

  const nodes = ordered.map((n) => {
    const { w, h } = canvasNodeSize(n);
    return {
      id: n.id,
      type: "text",
      text: canvasNodeText(n),
      x: pos[n.id].x,
      y: pos[n.id].y,
      width: w,
      height: h,
      color: TYPE_COLOR[n.type] ?? TYPE_COLOR.other,
    };
  });

  const edges = graph.edges.map((e) => ({
    id: e.id,
    fromNode: e.source,
    toNode: e.target,
    toEnd: "arrow",
    label: e.label,
  }));

  return JSON.stringify({ nodes, edges }, null, 2);
}

/** Deterministic sunflower/phyllotaxis layout — organic spread, no physics sim. */
function phyllotaxis(ids: string[], spacing: number): Record<string, { x: number; y: number }> {
  const golden = Math.PI * (3 - Math.sqrt(5));
  const out: Record<string, { x: number; y: number }> = {};
  ids.forEach((id, i) => {
    const r = spacing * Math.sqrt(i + 0.5);
    const t = i * golden;
    out[id] = { x: Math.round(r * Math.cos(t)), y: Math.round(r * Math.sin(t)) };
  });
  return out;
}

function canvasNodeSize(n: GraphNode): { w: number; h: number } {
  const w = Math.min(360, Math.max(200, 120 + n.label.length * 8));
  const h = 60 + Math.min(60, Math.max(0, (n.mentions - 1) * 6));
  return { w: Math.round(w), h: Math.round(h) };
}

function canvasNodeText(n: GraphNode): string {
  // JSON.stringify turns these real newlines into \n correctly.
  return `**${n.label}**\n_${n.type} · ${n.mentions} mention${n.mentions === 1 ? "" : "s"}_`;
}

// ---------------------------------------------------------------------------
// 3. Obsidian vault — one Markdown note per node, wikilinks → Graph View
// ---------------------------------------------------------------------------

export interface VaultFile {
  path: string;
  content: string;
}

export function toObsidianVault(graph: ExportableGraph): VaultFile[] {
  const lut = propLookup(graph);
  const nameById = uniqueNames(graph.nodes);
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n] as const));

  return graph.nodes.map((n) => {
    const base = nameById.get(n.id) ?? "untitled";
    const outgoing = graph.edges.filter((e) => e.source === n.id);

    // Aliases: original label (if sanitised away) + merged surface forms.
    const aliases = new Set<string>();
    if (n.label !== base) aliases.add(n.label);
    for (const a of n.aliases ?? []) if (a !== base && a !== n.label) aliases.add(a);

    const fm: string[] = ["---"];
    if (aliases.size) {
      fm.push("aliases:");
      for (const a of aliases) fm.push(`  - ${yamlStr(a)}`);
    }
    fm.push(
      `type: ${n.type}`,
      `mentions: ${n.mentions}`,
      `degree: ${n.degree}`,
      `rank: ${n.rank}`,
      "---",
    );

    // Outgoing links render the graph edges (incoming show as backlinks for free).
    const rels = outgoing
      .map((e) => {
        const target = nodeById.get(e.target);
        const tbase = nameById.get(e.target);
        if (!target || !tbase) return null;
        const link = target.label === tbase ? `[[${tbase}]]` : `[[${tbase}|${target.label}]]`;
        return `- ${e.label} ${link}`;
      })
      .filter(Boolean) as string[];

    // Provenance: dedup proposition ids across this node's outgoing edges.
    const claimIds = new Set<string>();
    for (const e of outgoing) for (const pid of e.propositions ?? []) claimIds.add(pid);
    const claims = [...claimIds]
      .map((id) => lut[id])
      .filter(Boolean)
      .map((t) => `- ${t}`);

    const body = [
      fm.join("\n"),
      "",
      `# ${n.label}`,
      "",
      `> Type: ${n.type} · Mentions: ${n.mentions} · Degree: ${n.degree}`,
      rels.length ? `\n## Relationships\n\n${rels.join("\n")}` : "",
      claims.length ? `\n## Supporting claims\n\n${claims.join("\n")}` : "",
      "",
    ].join("\n");

    return { path: `${base}.md`, content: body };
  });
}

/** Obsidian-illegal chars → space; then de-duplicate collisions with suffixes. */
function uniqueNames(nodes: GraphNode[]): Map<string, string> {
  const used = new Map<string, number>();
  const map = new Map<string, string>();
  for (const n of nodes) {
    let base =
      n.label
        .replace(/[\\/:*?"<>|#^[\]]/g, " ")
        .replace(/\s+/g, " ")
        .trim() || "untitled";
    const key = base.toLowerCase();
    if (used.has(key)) {
      const c = (used.get(key) ?? 0) + 1;
      used.set(key, c);
      base = `${base} (${c})`;
    } else {
      used.set(key, 1);
    }
    map.set(n.id, base);
  }
  return map;
}

// ---------------------------------------------------------------------------
// 4. Cytoscape.js JSON
// ---------------------------------------------------------------------------

export function toCytoscape(graph: ExportableGraph): string {
  const elements = {
    nodes: graph.nodes.map((n) => ({
      data: { id: n.id, label: n.label, type: n.type, mentions: n.mentions, rank: n.rank },
    })),
    edges: graph.edges.map((e) => ({
      data: { id: e.id, source: e.source, target: e.target, label: e.label, weight: e.weight },
    })),
  };
  return JSON.stringify({ elements }, null, 2);
}

// ---------------------------------------------------------------------------
// 5. GraphML — Gephi / yEd
// ---------------------------------------------------------------------------

export function toGraphML(graph: ExportableGraph): string {
  const keys = [
    `  <key id="label" for="node" attr.name="label" attr.type="string"/>`,
    `  <key id="type" for="node" attr.name="type" attr.type="string"/>`,
    `  <key id="mentions" for="node" attr.name="mentions" attr.type="int"/>`,
    `  <key id="rank" for="node" attr.name="rank" attr.type="double"/>`,
    `  <key id="elabel" for="edge" attr.name="label" attr.type="string"/>`,
    `  <key id="weight" for="edge" attr.name="weight" attr.type="int"/>`,
  ].join("\n");

  const nodes = graph.nodes
    .map(
      (n) => `    <node id="${xml(n.id)}">
      <data key="label">${xml(n.label)}</data>
      <data key="type">${xml(n.type)}</data>
      <data key="mentions">${n.mentions}</data>
      <data key="rank">${n.rank}</data>
    </node>`,
    )
    .join("\n");

  const edges = graph.edges
    .map(
      (e) => `    <edge id="${xml(e.id)}" source="${xml(e.source)}" target="${xml(e.target)}">
      <data key="elabel">${xml(e.label)}</data>
      <data key="weight">${e.weight}</data>
    </edge>`,
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<graphml xmlns="http://graphml.graphdrawing.org/xmlns">
${keys}
  <graph edgedefault="directed">
${nodes}
${edges}
  </graph>
</graphml>`;
}

// ---------------------------------------------------------------------------
// Download wiring (browser)
// ---------------------------------------------------------------------------

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function downloadText(filename: string, content: string, mime = "text/plain"): void {
  downloadBlob(filename, new Blob([content], { type: mime }));
}

/** Zip the vault (folder of .md) + a Canvas, and trigger a download. */
export async function downloadObsidianVault(
  graph: ExportableGraph,
  zipName?: string,
): Promise<void> {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  const folder = zip.folder("Lattice");
  if (!folder) throw new Error("JSZip could not create the vault folder");
  for (const f of toObsidianVault(graph)) folder.file(f.path, f.content);
  folder.file("_graph.canvas", toJSONCanvas(graph)); // spatial view alongside the notes
  const blob = await zip.generateAsync({ type: "blob" });
  downloadBlob(zipName ?? `${slugTitle(graph)}-vault.zip`, blob);
}

export type ExportFormat =
  | "portable-json"
  | "json-canvas"
  | "obsidian-vault"
  | "cytoscape"
  | "graphml";

/** One entry point for a UI export menu. */
export async function downloadGraph(graph: ExportableGraph, format: ExportFormat): Promise<void> {
  const name = slugTitle(graph);
  switch (format) {
    case "portable-json":
      return downloadText(`${name}.json`, toPortableJSON(graph), "application/json");
    case "json-canvas":
      return downloadText(`${name}.canvas`, toJSONCanvas(graph), "application/json");
    case "cytoscape":
      return downloadText(`${name}.cyjs.json`, toCytoscape(graph), "application/json");
    case "graphml":
      return downloadText(`${name}.graphml`, toGraphML(graph), "application/xml");
    case "obsidian-vault":
      return downloadObsidianVault(graph);
  }
}
