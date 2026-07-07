import { useCallback, useEffect, useState } from "react";
import { downloadGraph, type ExportFormat } from "../core/export";
import { ingestFile } from "../core/ingest";
import {
  deleteGraph,
  listGraphs,
  loadGraph,
  type SavedGraphSummary,
  saveGraph,
} from "../core/persist";
import { runPipeline } from "../core/pipeline";
import { estimateTokens, TOKEN_GUARDRAIL } from "../core/tokens";
import type { Availability, GraphEdge, InferenceMode, KnowledgeGraph } from "../core/types";
import { checkAvailability, createEngine, privateEngineId } from "../engines";
import {
  DEFAULT_WEBLLM_MODEL,
  freeStorageGB,
  isModelCached,
  WEBLLM_MODELS,
} from "../engines/webllm";
import { GraphView, type Selection } from "./GraphView";
import { SAMPLE_TEXT } from "./sample";

const EXPORT_FORMATS: { id: ExportFormat; label: string }[] = [
  { id: "portable-json", label: "Portable JSON" },
  { id: "json-canvas", label: "JSON Canvas (Obsidian)" },
  { id: "obsidian-vault", label: "Obsidian vault (.zip)" },
  { id: "cytoscape", label: "Cytoscape.js" },
  { id: "graphml", label: "GraphML (Gephi/yEd)" },
];

export default function App() {
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  const [mode, setMode] = useState<InferenceMode>(() =>
    localStorage.getItem("lattice.mode") === "quality" ? "quality" : "private",
  );
  const [webllmModel, setWebllmModel] = useState(
    () => localStorage.getItem("lattice.webllmModel") ?? DEFAULT_WEBLLM_MODEL,
  );
  const [modelCached, setModelCached] = useState<boolean | null>(null);
  const [freeGB, setFreeGB] = useState<number | null>(null);
  const [needsConsent, setNeedsConsent] = useState(false);
  const [availability, setAvailability] = useState<Record<string, Availability>>({});
  const [status, setStatus] = useState("");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guardrail, setGuardrail] = useState<number | null>(null);
  const [graph, setGraph] = useState<KnowledgeGraph | null>(null);
  const [dropped, setDropped] = useState<number[]>([]);
  const [selection, setSelection] = useState<Selection>(null);
  const [saved, setSaved] = useState<SavedGraphSummary[]>([]);
  const [exportFormat, setExportFormat] = useState<ExportFormat>("portable-json");

  const refreshSaved = useCallback(() => {
    listGraphs()
      .then(setSaved)
      .catch(() => setSaved([]));
  }, []);

  useEffect(() => {
    checkAvailability().then(setAvailability);
    freeStorageGB().then(setFreeGB);
    refreshSaved();
  }, [refreshSaved]);

  useEffect(() => {
    localStorage.setItem("lattice.mode", mode);
  }, [mode]);

  useEffect(() => {
    localStorage.setItem("lattice.webllmModel", webllmModel);
    setNeedsConsent(false);
    setModelCached(null);
    isModelCached(webllmModel).then(setModelCached);
  }, [webllmModel]);

  // Dev override: ?engine=webllm exercises the fallback path on Nano-capable machines.
  const activeEngine =
    new URLSearchParams(window.location.search).get("engine") === "webllm"
      ? "webllm"
      : privateEngineId(availability);
  const engineUsable = mode === "private" && availability[activeEngine] !== "unavailable";
  const webllmChoice = WEBLLM_MODELS.find((m) => m.id === webllmModel) ?? WEBLLM_MODELS[0];

  async function runText(body: string, force: boolean, downloadConsented = false) {
    setError(null);
    if (!body.trim()) {
      setError("Paste some text or upload a document first.");
      return;
    }
    const estimate = estimateTokens(body);
    if (!force && estimate > TOKEN_GUARDRAIL) {
      setGuardrail(estimate);
      return;
    }
    // §1a: no bytes move without explicit consent to the download.
    if (activeEngine === "webllm" && modelCached === false && !downloadConsented) {
      setNeedsConsent(true);
      return;
    }
    setNeedsConsent(false);
    setGuardrail(null);
    setRunning(true);
    setSelection(null);
    const engine = createEngine(activeEngine, { webllmModel });
    try {
      setStatus("Preparing engine…");
      await engine.init((p) =>
        setStatus(`${modelCached ? "Loading" : "Downloading"} model… ${Math.round(p * 100)}%`),
      );
      if (activeEngine === "webllm") setModelCached(true);
      const result = await runPipeline(body, engine, {
        title: title.trim() || undefined,
        callbacks: {
          onStage: setStatus,
          onChunk: (done, total) => setProgress({ done, total }),
        },
      });
      setGraph(result.graph);
      setDropped(result.droppedChunks);
      setStatus(
        `Done — ${result.graph.nodes.length} nodes, ${result.graph.edges.length} edges from ${result.graph.meta.chunkCount} chunks.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus("");
    } finally {
      setProgress(null);
      setRunning(false);
      engine.dispose().catch(() => {});
    }
  }

  function truncateAndRun() {
    const cut = text.slice(0, TOKEN_GUARDRAIL * 4);
    setText(cut);
    runText(cut, true);
  }

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    setStatus(`Reading ${file.name}…`);
    try {
      const result = await ingestFile(file);
      setText(result.text);
      setTitle(result.title);
      setStatus(`Loaded ${file.name} (~${estimateTokens(result.text)} tokens).`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus("");
    }
  }

  async function onSave() {
    if (!graph) return;
    await saveGraph(graph);
    refreshSaved();
    setStatus("Graph saved.");
  }

  async function onLoad(id: string) {
    const g = await loadGraph(id);
    if (g) {
      setGraph(g);
      setSelection(null);
      setDropped([]);
      setTitle(g.meta.title ?? "");
      setStatus(`Loaded “${g.meta.title ?? "untitled"}”.`);
    }
  }

  const onSelect = useCallback((sel: Selection) => setSelection(sel), []);

  return (
    <div className="app">
      <header>
        <h1>Lattice</h1>
        <span className="tagline">documents → propositions → knowledge graph, all on-device</span>
      </header>
      <main>
        <aside className="panel input-panel">
          <label htmlFor="doc-title">Title</label>
          <input
            id="doc-title"
            value={title}
            placeholder="optional document title"
            onChange={(e) => setTitle(e.target.value)}
          />
          <label htmlFor="doc-text">Text</label>
          <textarea
            id="doc-text"
            value={text}
            placeholder="Paste text here, or upload a document below…"
            onChange={(e) => setText(e.target.value)}
          />
          <div className="row">
            <button type="button" onClick={() => setText(SAMPLE_TEXT)} disabled={running}>
              Load sample
            </button>
            <label className="upload-btn">
              Upload PDF / DOCX / TXT
              <input type="file" accept=".pdf,.docx,.txt,.md" onChange={onUpload} hidden />
            </label>
          </div>
          <span className="section-label">Mode</span>
          <div className="mode-toggle">
            <button
              type="button"
              className={mode === "private" ? "active" : ""}
              onClick={() => setMode("private")}
              disabled={running}
            >
              Private · on-device
            </button>
            <button
              type="button"
              className={mode === "quality" ? "active" : ""}
              disabled
              title="Arrives at M7 — bring your own OpenRouter key"
            >
              High quality · cloud (soon)
            </button>
          </div>

          {mode === "private" && activeEngine === "prompt-api" && (
            <div className="status">
              Engine: Gemini Nano (built-in)
              {availability["prompt-api"] === "downloadable"
                ? " — Chrome will fetch it on first run"
                : ""}
            </div>
          )}
          {mode === "private" && activeEngine === "webllm" && (
            <>
              <label htmlFor="webllm-model">Model (runs in your browser)</label>
              <select
                id="webllm-model"
                value={webllmModel}
                onChange={(e) => setWebllmModel(e.target.value)}
                disabled={running}
              >
                {WEBLLM_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label} — ~{m.sizeGB} GB download
                  </option>
                ))}
              </select>
              <div className="status">
                {modelCached === null
                  ? "Checking model cache…"
                  : modelCached
                    ? "Model cached — no download needed."
                    : `Needs a one-time ~${webllmChoice.sizeGB} GB download (stored in this browser).`}
              </div>
            </>
          )}

          <button
            type="button"
            className="primary"
            onClick={() => runText(text, false)}
            disabled={running || !engineUsable}
          >
            {running ? "Running…" : "Build graph"}
          </button>

          {needsConsent && (
            <div className="banner warn">
              <strong>One-time model download.</strong> {webllmChoice.label} is ~
              {webllmChoice.sizeGB} GB of browser storage
              {freeGB !== null ? ` (you have ~${freeGB.toFixed(1)} GB free)` : ""} and needs a GPU
              with ~{webllmChoice.vramGB} GB of memory while running. It stays cached — future runs
              start instantly, and nothing ever leaves your device.
              {freeGB !== null && freeGB < webllmChoice.sizeGB * 1.5 && (
                <div>⚠ Storage is tight — consider a smaller model.</div>
              )}
              <div className="row">
                <button type="button" onClick={() => runText(text, false, true)}>
                  Download ~{webllmChoice.sizeGB} GB &amp; build
                </button>
                <button type="button" onClick={() => setNeedsConsent(false)}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {!engineUsable && mode === "private" && (
            <div className="banner warn">
              No on-device engine is available: Gemini Nano needs desktop Chrome 138+ with built-in
              AI, and WebLLM needs a WebGPU-capable browser. The cloud mode (M7) will cover this
              case.
            </div>
          )}

          {guardrail !== null && (
            <div className="banner warn">
              ~{guardrail.toLocaleString()} tokens — past the ~{TOKEN_GUARDRAIL.toLocaleString()}
              -token (~10 page) guardrail. Long inputs are slower and noisier.
              <div className="row">
                <button type="button" onClick={() => runText(text, true)}>
                  Proceed anyway
                </button>
                <button type="button" onClick={truncateAndRun}>
                  Truncate &amp; run
                </button>
              </div>
            </div>
          )}
          {error && <div className="banner error">{error}</div>}
          {status && <div className="status">{status}</div>}
          {progress && (
            <progress value={progress.done} max={progress.total}>
              {progress.done}/{progress.total}
            </progress>
          )}
          {dropped.length > 0 && (
            <div className="banner warn">
              Dropped {dropped.length} chunk{dropped.length === 1 ? "" : "s"} after repeated invalid
              model output: {dropped.join(", ")}
            </div>
          )}

          {graph && (
            <>
              <hr />
              <label htmlFor="export-format">Export</label>
              <div className="row">
                <select
                  id="export-format"
                  value={exportFormat}
                  onChange={(e) => setExportFormat(e.target.value as ExportFormat)}
                >
                  {EXPORT_FORMATS.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.label}
                    </option>
                  ))}
                </select>
                <button type="button" onClick={() => downloadGraph(graph, exportFormat)}>
                  Download
                </button>
              </div>
              <button type="button" onClick={onSave}>
                Save to browser
              </button>
            </>
          )}

          {saved.length > 0 && (
            <>
              <hr />
              <span className="section-label">Saved graphs</span>
              <ul className="saved-list">
                {saved.map((s) => (
                  <li key={s.id}>
                    <button type="button" className="link" onClick={() => onLoad(s.id)}>
                      {s.title}
                    </button>
                    <span className="meta">
                      {s.nodeCount}n/{s.edgeCount}e
                    </span>
                    <button
                      type="button"
                      className="link danger"
                      onClick={() => deleteGraph(s.id).then(refreshSaved)}
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </aside>

        <section className="graph-area">
          {graph ? (
            <GraphView graph={graph} onSelect={onSelect} />
          ) : (
            <div className="graph-canvas graph-empty">
              Paste text and hit “Build graph” to see something here.
            </div>
          )}
        </section>

        <aside className="panel details-panel">
          {graph && selection ? (
            <Details graph={graph} selection={selection} />
          ) : (
            <div className="hint">
              {graph
                ? "Click a node to inspect it, or an edge to see the claims behind it."
                : "The provenance panel lives here."}
            </div>
          )}
        </aside>
      </main>
    </div>
  );
}

function Details({ graph, selection }: { graph: KnowledgeGraph; selection: Selection }) {
  if (!selection) return null;
  const propText = new Map((graph.propositions ?? []).map((p) => [p.id, p.text]));
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));

  if (selection.kind === "node") {
    const node = nodeById.get(selection.id);
    if (!node) return null;
    const incident = graph.edges.filter((e) => e.source === node.id || e.target === node.id);
    return (
      <div>
        <h2>{node.label}</h2>
        <p className="meta">
          {node.type} · {node.mentions} mention{node.mentions === 1 ? "" : "s"} · degree{" "}
          {node.degree} · rank {node.rank.toFixed(4)}
        </p>
        {node.aliases.length > 0 && <p className="meta">also seen as: {node.aliases.join(", ")}</p>}
        <h3>Relations ({incident.length})</h3>
        <ul>
          {incident.map((e) => (
            <li key={e.id}>
              {e.source === node.id
                ? `→ ${e.label} ${nodeById.get(e.target)?.label ?? e.target}`
                : `← ${nodeById.get(e.source)?.label ?? e.source} ${e.label}`}
            </li>
          ))}
        </ul>
        <p className="meta">source chunks: {node.sourceChunks.join(", ")}</p>
      </div>
    );
  }

  const edge = graph.edges.find((e) => e.id === selection.id);
  if (!edge) return null;
  return <EdgeDetails edge={edge} nodeById={nodeById} propText={propText} />;
}

function EdgeDetails({
  edge,
  nodeById,
  propText,
}: {
  edge: GraphEdge;
  nodeById: Map<string, KnowledgeGraph["nodes"][number]>;
  propText: Map<string, string>;
}) {
  const claims = edge.propositions.map((id) => propText.get(id)).filter(Boolean) as string[];
  return (
    <div>
      <h2>
        {nodeById.get(edge.source)?.label} <em>{edge.label}</em> {nodeById.get(edge.target)?.label}
      </h2>
      <p className="meta">
        weight {edge.weight} · {edge.propositions.length} supporting proposition
        {edge.propositions.length === 1 ? "" : "s"}
      </p>
      <h3>Supporting claims</h3>
      {claims.length > 0 ? (
        <ul>
          {claims.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      ) : (
        <p className="meta">No proposition text on this graph (older save?).</p>
      )}
    </div>
  );
}
