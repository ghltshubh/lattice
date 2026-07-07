/**
 * IndexedDB persistence (BUILD_PLAN M6): save/load named graphs via `idb`.
 */

import { type IDBPDatabase, openDB } from "idb";
import type { KnowledgeGraph } from "./types";

const DB_NAME = "lattice";
const STORE = "graphs";

interface SavedGraph {
  id: string;
  savedAt: string;
  graph: KnowledgeGraph;
}

export interface SavedGraphSummary {
  id: string;
  title: string;
  savedAt: string;
  nodeCount: number;
  edgeCount: number;
}

let dbPromise: Promise<IDBPDatabase> | null = null;

function db(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, 1, {
      upgrade(d) {
        d.createObjectStore(STORE, { keyPath: "id" });
      },
    });
  }
  return dbPromise;
}

export async function saveGraph(graph: KnowledgeGraph): Promise<string> {
  const id = `g-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const record: SavedGraph = { id, savedAt: new Date().toISOString(), graph };
  await (await db()).put(STORE, record);
  return id;
}

export async function listGraphs(): Promise<SavedGraphSummary[]> {
  const all = (await (await db()).getAll(STORE)) as SavedGraph[];
  return all
    .map((r) => ({
      id: r.id,
      title: r.graph.meta.title ?? "untitled",
      savedAt: r.savedAt,
      nodeCount: r.graph.nodes.length,
      edgeCount: r.graph.edges.length,
    }))
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

export async function loadGraph(id: string): Promise<KnowledgeGraph | undefined> {
  const record = (await (await db()).get(STORE, id)) as SavedGraph | undefined;
  return record?.graph;
}

export async function deleteGraph(id: string): Promise<void> {
  await (await db()).delete(STORE, id);
}
