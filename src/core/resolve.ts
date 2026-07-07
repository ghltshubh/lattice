/**
 * Cross-chunk entity resolution (BUILD_PLAN §6).
 *
 * normalize → exact merge → fuzzy merge (embedding cosine, or Jaro-Winkler
 * fallback when no embedder is available) → union-find → canonical labels.
 * At the ~10-page ceiling entity counts are low, so O(n²) pairwise is fine.
 */

import type { EntityType } from "./types";

export interface MentionOccurrence {
  name: string;
  type: EntityType;
  chunkIndex: number;
}

export interface ResolvedEntity {
  id: string;
  label: string;
  type: EntityType;
  aliases: string[];
  mentions: number;
  sourceChunks: number[];
}

/** Embeds each text; returns one unit-normalized vector per input. */
export type Embedder = (texts: string[]) => Promise<number[][]>;

export interface ResolveOptions {
  embedder?: Embedder | null;
  /** cosine threshold for embedding merge — tune empirically (§11) */
  cosineThreshold?: number;
  /** Jaro-Winkler threshold for the no-embeddings fallback */
  jaroWinklerThreshold?: number;
}

export interface ResolutionResult {
  entities: ResolvedEntity[];
  /** canonical entity id for a surface form, or undefined if never seen */
  idFor(name: string, type: EntityType): string | undefined;
}

export function normKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/^(the|a|an)\s+/i, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

class UnionFind {
  private parent: number[];
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
  }
  find(i: number): number {
    while (this.parent[i] !== i) {
      this.parent[i] = this.parent[this.parent[i]];
      i = this.parent[i];
    }
    return i;
  }
  union(a: number, b: number): void {
    this.parent[this.find(a)] = this.find(b);
  }
}

export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1;
  const la = a.length;
  const lb = b.length;
  if (la === 0 || lb === 0) return 0;
  const window = Math.max(0, Math.floor(Math.max(la, lb) / 2) - 1);
  const matchA = new Array<boolean>(la).fill(false);
  const matchB = new Array<boolean>(lb).fill(false);
  let matches = 0;
  for (let i = 0; i < la; i++) {
    const lo = Math.max(0, i - window);
    const hi = Math.min(lb - 1, i + window);
    for (let j = lo; j <= hi; j++) {
      if (!matchB[j] && a[i] === b[j]) {
        matchA[i] = true;
        matchB[j] = true;
        matches++;
        break;
      }
    }
  }
  if (matches === 0) return 0;
  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < la; i++) {
    if (!matchA[i]) continue;
    while (!matchB[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }
  const m = matches;
  const jaro = (m / la + m / lb + (m - transpositions / 2) / m) / 3;
  let prefix = 0;
  for (let i = 0; i < Math.min(4, la, lb) && a[i] === b[i]; i++) prefix++;
  return jaro + prefix * 0.1 * (1 - jaro);
}

function cosine(u: number[], v: number[]): number {
  let dot = 0;
  for (let i = 0; i < u.length; i++) dot += u[i] * v[i];
  return dot; // vectors are unit-normalized
}

/** One exact-merge cluster: identical normKey + type. */
interface SurfaceCluster {
  key: string;
  type: EntityType;
  /** surface form → occurrence count */
  forms: Map<string, number>;
  mentions: number;
  chunks: Set<number>;
}

export async function resolveEntities(
  occurrences: MentionOccurrence[],
  options: ResolveOptions = {},
): Promise<ResolutionResult> {
  const cosineThreshold = options.cosineThreshold ?? 0.83;
  const jwThreshold = options.jaroWinklerThreshold ?? 0.92;

  // 1–3. Normalize + exact merge on (normKey, type).
  const byKey = new Map<string, SurfaceCluster>();
  for (const occ of occurrences) {
    const key = normKey(occ.name);
    if (!key) continue;
    const mapKey = `${key}::${occ.type}`;
    let cluster = byKey.get(mapKey);
    if (!cluster) {
      cluster = { key, type: occ.type, forms: new Map(), mentions: 0, chunks: new Set() };
      byKey.set(mapKey, cluster);
    }
    cluster.forms.set(occ.name, (cluster.forms.get(occ.name) ?? 0) + 1);
    cluster.mentions++;
    cluster.chunks.add(occ.chunkIndex);
  }

  const clusters = [...byKey.values()];
  const uf = new UnionFind(clusters.length);

  // 4. Fuzzy merge across surviving clusters of the SAME type.
  let vectors: number[][] | null = null;
  if (options.embedder && clusters.length > 1) {
    try {
      vectors = await options.embedder(clusters.map((c) => c.key));
    } catch {
      vectors = null; // embedder unavailable at runtime → string fallback
    }
  }
  for (let i = 0; i < clusters.length; i++) {
    for (let j = i + 1; j < clusters.length; j++) {
      if (clusters[i].type !== clusters[j].type) continue;
      const similar = vectors
        ? cosine(vectors[i], vectors[j]) >= cosineThreshold
        : jaroWinkler(clusters[i].key, clusters[j].key) >= jwThreshold;
      if (similar) uf.union(i, j);
    }
  }

  // 5–6. Materialize union-find groups; canonical label = most frequent form (ties → longest).
  const groups = new Map<number, SurfaceCluster[]>();
  clusters.forEach((c, i) => {
    const root = uf.find(i);
    const list = groups.get(root) ?? [];
    list.push(c);
    groups.set(root, list);
  });

  const entities: ResolvedEntity[] = [];
  const idByMapKey = new Map<string, string>();
  for (const members of groups.values()) {
    const id = `n${entities.length}`;
    const forms = new Map<string, number>();
    const chunks = new Set<number>();
    let mentions = 0;
    for (const m of members) {
      for (const [form, count] of m.forms) forms.set(form, (forms.get(form) ?? 0) + count);
      for (const c of m.chunks) chunks.add(c);
      mentions += m.mentions;
      idByMapKey.set(`${m.key}::${m.type}`, id);
    }
    const label = [...forms.entries()].sort(
      (a, b) => b[1] - a[1] || b[0].length - a[0].length,
    )[0][0];
    entities.push({
      id,
      label,
      type: members[0].type,
      aliases: [...forms.keys()].filter((f) => f !== label),
      mentions,
      sourceChunks: [...chunks].sort((a, b) => a - b),
    });
  }

  return {
    entities,
    idFor: (name, type) => idByMapKey.get(`${normKey(name)}::${type}`),
  };
}
