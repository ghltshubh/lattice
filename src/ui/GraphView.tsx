/**
 * Sigma.js graph canvas (BUILD_PLAN M4): node size by mentions, color by
 * entity type, click node → highlight neighbors, click edge → provenance
 * (surfaced by the parent through onSelect).
 */

import circular from "graphology-layout/circular";
import forceAtlas2 from "graphology-layout-forceatlas2";
import { useEffect, useRef } from "react";
import Sigma from "sigma";
import { TYPE_COLOR } from "../core/export";
import { toGraphology } from "../core/graph";
import type { EntityType, KnowledgeGraph } from "../core/types";

export type Selection = { kind: "node" | "edge"; id: string } | null;

interface Props {
  graph: KnowledgeGraph;
  onSelect: (selection: Selection) => void;
}

const DIM_COLOR = "#2b2f3a";

export function GraphView({ graph, onSelect }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const highlightRef = useRef<{ nodes: Set<string>; edges: Set<string> } | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || graph.nodes.length === 0) return;

    const g = toGraphology(graph);
    circular.assign(g);
    if (g.order > 2) {
      forceAtlas2.assign(g, {
        iterations: Math.min(500, 100 + g.order * 5),
        settings: forceAtlas2.inferSettings(g),
      });
    }
    g.forEachNode((id, attrs) => {
      g.mergeNodeAttributes(id, {
        size: 5 + Math.sqrt(attrs.mentions ?? 1) * 3,
        color: TYPE_COLOR[attrs.entityType as EntityType] ?? TYPE_COLOR.other,
      });
    });
    g.forEachEdge((id, attrs) => {
      g.mergeEdgeAttributes(id, {
        size: Math.min(1 + (attrs.weight ?? 1) * 0.7, 5),
        type: "arrow",
        color: "#4a5065",
      });
    });

    const sigma = new Sigma(g, container, {
      renderEdgeLabels: true,
      enableEdgeEvents: true,
      labelColor: { color: "#c8cede" },
      edgeLabelColor: { color: "#8890a4" },
      labelSize: 12,
      edgeLabelSize: 10,
      labelRenderedSizeThreshold: 2,
      nodeReducer: (node, data) => {
        const h = highlightRef.current;
        if (h && !h.nodes.has(node)) return { ...data, color: DIM_COLOR, label: "" };
        return data;
      },
      edgeReducer: (edge, data) => {
        const h = highlightRef.current;
        if (h && !h.edges.has(edge)) return { ...data, hidden: true };
        return data;
      },
    });

    sigma.on("clickNode", ({ node }) => {
      highlightRef.current = {
        nodes: new Set([node, ...g.neighbors(node)]),
        edges: new Set(g.edges(node)),
      };
      sigma.refresh();
      onSelect({ kind: "node", id: node });
    });
    sigma.on("clickEdge", ({ edge }) => {
      highlightRef.current = {
        nodes: new Set([g.source(edge), g.target(edge)]),
        edges: new Set([edge]),
      };
      sigma.refresh();
      onSelect({ kind: "edge", id: edge });
    });
    sigma.on("clickStage", () => {
      highlightRef.current = null;
      sigma.refresh();
      onSelect(null);
    });

    return () => {
      sigma.kill();
      highlightRef.current = null;
    };
  }, [graph, onSelect]);

  if (graph.nodes.length === 0) {
    return <div className="graph-canvas graph-empty">No nodes — run an extraction first.</div>;
  }
  return <div ref={containerRef} className="graph-canvas" />;
}
