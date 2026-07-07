import { describe, expect, it } from "vitest";
import { assembleGraph } from "./graph";
import type { GraphMeta, Proposition } from "./types";

const META: GraphMeta = {
  createdAt: "2026-01-01T00:00:00.000Z",
  engine: "prompt-api",
  model: "test",
  chunkCount: 2,
  tokenEstimate: 100,
};

function prop(
  id: string,
  subject: string,
  predicate: string,
  object: string,
  text = `${subject} ${predicate} ${object}.`,
): Proposition {
  return {
    id,
    text,
    subject: { name: subject, type: "concept" },
    predicate,
    object: { name: object, type: "concept" },
  };
}

describe("assembleGraph", () => {
  it("dedupes parallel edges by (source, predicate, target) and accumulates provenance", async () => {
    const graph = await assembleGraph(
      [
        { chunkIndex: 0, propositions: [prop("p1", "Alpha", "links to", "Beta")] },
        { chunkIndex: 1, propositions: [prop("p1", "Alpha", "links to", "Beta")] },
      ],
      META,
    );
    expect(graph.nodes).toHaveLength(2);
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0].weight).toBe(2);
    expect(graph.edges[0].propositions).toHaveLength(2);
  });

  it("keeps distinct predicates as separate edges between the same nodes", async () => {
    const graph = await assembleGraph(
      [
        {
          chunkIndex: 0,
          propositions: [
            prop("p1", "Alpha", "links to", "Beta"),
            prop("p2", "Alpha", "depends on", "Beta"),
          ],
        },
      ],
      META,
    );
    expect(graph.edges).toHaveLength(2);
  });

  it("computes degree and PageRank on the resolved graph", async () => {
    const graph = await assembleGraph(
      [
        {
          chunkIndex: 0,
          propositions: [
            prop("p1", "Alpha", "links to", "Beta"),
            prop("p2", "Gamma", "links to", "Beta"),
          ],
        },
      ],
      META,
    );
    const beta = graph.nodes.find((n) => n.label === "Beta");
    const alpha = graph.nodes.find((n) => n.label === "Alpha");
    expect(beta?.degree).toBe(2);
    expect(alpha?.degree).toBe(1);
    expect(beta && beta.rank > 0).toBe(true);
    // Everything points at Beta — it must outrank a source-only node.
    expect(beta && alpha && beta.rank > alpha.rank).toBe(true);
  });

  it("carries proposition records for provenance display/export", async () => {
    const graph = await assembleGraph(
      [{ chunkIndex: 3, propositions: [prop("p1", "Alpha", "links to", "Beta", "Alpha links.")] }],
      META,
    );
    expect(graph.propositions).toHaveLength(1);
    expect(graph.propositions?.[0]).toMatchObject({ text: "Alpha links.", sourceChunk: 3 });
    expect(graph.edges[0].propositions[0]).toBe(graph.propositions?.[0].id);
  });

  it("merges mention variants into one node with aliases", async () => {
    const graph = await assembleGraph(
      [
        { chunkIndex: 0, propositions: [prop("p1", "The Knowledge Graph", "shows", "Beta")] },
        { chunkIndex: 1, propositions: [prop("p1", "knowledge graph", "shows", "Beta")] },
      ],
      META,
    );
    const kg = graph.nodes.find((n) => n.label.toLowerCase().includes("knowledge"));
    expect(graph.nodes).toHaveLength(2);
    expect(kg?.mentions).toBe(2);
    expect(kg?.sourceChunks).toEqual([0, 1]);
  });

  it("produces an empty graph from empty extractions", async () => {
    const graph = await assembleGraph([], META);
    expect(graph.nodes).toHaveLength(0);
    expect(graph.edges).toHaveLength(0);
  });
});
