import { describe, expect, it } from "vitest";
import {
  type ExportableGraph,
  toCytoscape,
  toGraphML,
  toJSONCanvas,
  toObsidianVault,
  toPortableJSON,
} from "./export";

const GRAPH: ExportableGraph = {
  nodes: [
    {
      id: "n0",
      label: "Alpha & Co",
      type: "organization",
      aliases: ["Alpha"],
      mentions: 3,
      degree: 1,
      rank: 0.6,
      sourceChunks: [0],
    },
    {
      id: "n1",
      label: "Beta <Labs>",
      type: "organization",
      aliases: [],
      mentions: 1,
      degree: 1,
      rank: 0.4,
      sourceChunks: [0],
    },
  ],
  edges: [
    {
      id: "e0",
      source: "n0",
      target: "n1",
      label: "acquired",
      weight: 2,
      propositions: ["c0-p1-0"],
    },
  ],
  meta: {
    title: "test graph",
    createdAt: "2026-01-01T00:00:00.000Z",
    engine: "prompt-api",
    model: "test",
    chunkCount: 1,
    tokenEstimate: 50,
  },
  propositions: [{ id: "c0-p1-0", text: "Alpha & Co acquired Beta Labs.", sourceChunk: 0 }],
};

describe("toPortableJSON", () => {
  it("round-trips the graph", () => {
    const parsed = JSON.parse(toPortableJSON(GRAPH));
    expect(parsed.format).toBe("lattice.graph");
    expect(parsed.nodes).toHaveLength(2);
    expect(parsed.propositions).toHaveLength(1);
  });
});

describe("toJSONCanvas", () => {
  it("emits one canvas node per graph node and arrows on edges", () => {
    const canvas = JSON.parse(toJSONCanvas(GRAPH));
    expect(canvas.nodes).toHaveLength(2);
    expect(canvas.edges[0]).toMatchObject({ fromNode: "n0", toNode: "n1", toEnd: "arrow" });
    expect(canvas.nodes.every((n: { x: number; y: number }) => Number.isFinite(n.x))).toBe(true);
  });
});

describe("toGraphML", () => {
  it("xml-escapes labels", () => {
    const xml = toGraphML(GRAPH);
    expect(xml).toContain("Alpha &amp; Co");
    expect(xml).toContain("Beta &lt;Labs&gt;");
    expect(xml).not.toContain("<Labs>");
  });
});

describe("toCytoscape", () => {
  it("produces elements with node and edge data", () => {
    const cy = JSON.parse(toCytoscape(GRAPH));
    expect(cy.elements.nodes).toHaveLength(2);
    expect(cy.elements.edges[0].data.weight).toBe(2);
  });
});

describe("toObsidianVault", () => {
  it("writes one sanitized note per node with wikilinked relations and claims", () => {
    const files = toObsidianVault(GRAPH);
    expect(files).toHaveLength(2);
    const alpha = files.find((f) => f.path.startsWith("Alpha"));
    expect(alpha?.path.endsWith(".md")).toBe(true);
    expect(alpha?.path).not.toContain("<");
    expect(alpha?.content).toContain("acquired [[");
    expect(alpha?.content).toContain("Alpha & Co acquired Beta Labs.");
  });

  it("de-duplicates colliding note names", () => {
    const collided: ExportableGraph = {
      ...GRAPH,
      nodes: GRAPH.nodes.map((n) => ({ ...n, label: "Same Name" })),
      edges: [],
    };
    const paths = toObsidianVault(collided).map((f) => f.path);
    expect(new Set(paths).size).toBe(2);
  });
});
