/**
 * Sigma.js graph canvas (BUILD_PLAN M4): node size by mentions, color by
 * entity type, click node → highlight neighbors, click edge → provenance
 * (surfaced by the parent through onSelect).
 *
 * Label declutter: node labels use Sigma's density grid ("auto") so only
 * prominent nodes are named until you zoom; edge labels show on hover by
 * default. Both behaviors have explicit overrides in the corner control,
 * persisted per browser.
 */

import circular from "graphology-layout/circular";
import forceAtlas2 from "graphology-layout-forceatlas2";
import { useEffect, useRef, useState } from "react";
import Sigma from "sigma";
import { TYPE_COLOR } from "../core/export";
import { toGraphology } from "../core/graph";
import type { EntityType, KnowledgeGraph } from "../core/types";

export type Selection = { kind: "node" | "edge"; id: string } | null;

type EdgeLabelMode = "hover" | "all" | "off";
type NodeLabelMode = "auto" | "all";

interface Props {
  graph: KnowledgeGraph;
  onSelect: (selection: Selection) => void;
  /** Surfaces the live Sigma instance (null on teardown) for PNG/SVG export. */
  onSigma?: (sigma: Sigma | null) => void;
}

const DIM_COLOR = "#232833";
/** Canvas-only clipping — full label text stays in data, details and exports. */
const LABEL_MAX = 50;

function truncate(label: string): string {
  return label.length > LABEL_MAX ? `${label.slice(0, LABEL_MAX - 1)}…` : label;
}

function readEdgeMode(): EdgeLabelMode {
  const v = localStorage.getItem("lattice.edgeLabels");
  return v === "all" || v === "off" ? v : "hover";
}

function readNodeMode(): NodeLabelMode {
  return localStorage.getItem("lattice.nodeLabels") === "all" ? "all" : "auto";
}

function applyNodeLabelSettings(sigma: Sigma, mode: NodeLabelMode): void {
  if (mode === "all") {
    sigma.setSetting("labelDensity", 14);
    sigma.setSetting("labelGridCellSize", 1);
    sigma.setSetting("labelRenderedSizeThreshold", 0);
  } else {
    sigma.setSetting("labelDensity", 1);
    sigma.setSetting("labelGridCellSize", 120);
    sigma.setSetting("labelRenderedSizeThreshold", 7);
  }
}

export function GraphView({ graph, onSelect, onSigma }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const highlightRef = useRef<{ nodes: Set<string>; edges: Set<string> } | null>(null);
  const hoverRef = useRef<{ nodes: Set<string>; edges: Set<string> } | null>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const [edgeLabelMode, setEdgeLabelMode] = useState<EdgeLabelMode>(readEdgeMode);
  const [nodeLabelMode, setNodeLabelMode] = useState<NodeLabelMode>(readNodeMode);
  const edgeModeRef = useRef(edgeLabelMode);
  const nodeModeRef = useRef(nodeLabelMode);

  useEffect(() => {
    localStorage.setItem("lattice.edgeLabels", edgeLabelMode);
    edgeModeRef.current = edgeLabelMode;
    sigmaRef.current?.refresh();
  }, [edgeLabelMode]);

  useEffect(() => {
    localStorage.setItem("lattice.nodeLabels", nodeLabelMode);
    nodeModeRef.current = nodeLabelMode;
    const sigma = sigmaRef.current;
    if (sigma) {
      applyNodeLabelSettings(sigma, nodeLabelMode);
      sigma.refresh();
    }
  }, [nodeLabelMode]);

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
        label: truncate((attrs.label as string) ?? id),
        size: 5 + Math.sqrt(attrs.mentions ?? 1) * 3,
        color: TYPE_COLOR[attrs.entityType as EntityType] ?? TYPE_COLOR.other,
      });
    });
    g.forEachEdge((id, attrs) => {
      g.mergeEdgeAttributes(id, {
        size: Math.min(1 + (attrs.weight ?? 1) * 0.7, 5),
        type: "arrow",
        color: "#39404e",
      });
    });

    const sigma = new Sigma(g, container, {
      renderEdgeLabels: true,
      enableEdgeEvents: true,
      labelColor: { color: "#dfe3ea" },
      edgeLabelColor: { color: "#969dad" },
      labelSize: 12,
      edgeLabelSize: 10,
      nodeReducer: (node, data) => {
        let d = data;
        const pinned = highlightRef.current;
        if (pinned && !pinned.nodes.has(node)) d = { ...d, color: DIM_COLOR, label: "" };
        if (hoverRef.current?.nodes.has(node)) d = { ...d, forceLabel: true };
        return d;
      },
      edgeReducer: (edge, data) => {
        let d = data;
        const pinned = highlightRef.current;
        if (pinned && !pinned.edges.has(edge)) d = { ...d, hidden: true };
        const mode = edgeModeRef.current;
        const revealed =
          mode === "all" ||
          (mode === "hover" &&
            (hoverRef.current?.edges.has(edge) === true || pinned?.edges.has(edge) === true));
        if (!revealed) d = { ...d, label: null };
        return d;
      },
    });
    applyNodeLabelSettings(sigma, nodeModeRef.current);

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
    sigma.on("enterNode", ({ node }) => {
      hoverRef.current = {
        nodes: new Set([node, ...g.neighbors(node)]),
        edges: new Set(g.edges(node)),
      };
      sigma.refresh();
    });
    sigma.on("leaveNode", () => {
      hoverRef.current = null;
      sigma.refresh();
    });
    sigma.on("enterEdge", ({ edge }) => {
      hoverRef.current = {
        nodes: new Set([g.source(edge), g.target(edge)]),
        edges: new Set([edge]),
      };
      sigma.refresh();
    });
    sigma.on("leaveEdge", () => {
      hoverRef.current = null;
      sigma.refresh();
    });

    sigmaRef.current = sigma;
    onSigma?.(sigma);

    return () => {
      onSigma?.(null);
      sigmaRef.current = null;
      sigma.kill();
      highlightRef.current = null;
      hoverRef.current = null;
    };
  }, [graph, onSelect, onSigma]);

  if (graph.nodes.length === 0) {
    return <div className="graph-canvas graph-empty">No nodes — run an extraction first.</div>;
  }
  return (
    <div className="graph-wrap">
      <div ref={containerRef} className="graph-canvas" />
      <div className="canvas-controls">
        <label htmlFor="edge-labels">
          edge labels
          <select
            id="edge-labels"
            value={edgeLabelMode}
            onChange={(e) => setEdgeLabelMode(e.target.value as EdgeLabelMode)}
          >
            <option value="hover">on hover</option>
            <option value="all">all</option>
            <option value="off">off</option>
          </select>
        </label>
        <label htmlFor="node-labels">
          node labels
          <select
            id="node-labels"
            value={nodeLabelMode}
            onChange={(e) => setNodeLabelMode(e.target.value as NodeLabelMode)}
          >
            <option value="auto">auto</option>
            <option value="all">all</option>
          </select>
        </label>
      </div>
    </div>
  );
}
