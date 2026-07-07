import { describe, expect, it } from "vitest";
import type { MentionOccurrence } from "./resolve";
import { jaroWinkler, normKey, resolveEntities } from "./resolve";

function occ(
  name: string,
  type: MentionOccurrence["type"] = "concept",
  chunkIndex = 0,
): MentionOccurrence {
  return { name, type, chunkIndex };
}

describe("normKey", () => {
  it("lowercases, strips leading articles and punctuation", () => {
    expect(normKey("The Reconciliation Loop")).toBe("reconciliation loop");
    expect(normKey("  Marie   Curie. ")).toBe("marie curie");
    expect(normKey("a  Dog")).toBe("dog");
  });
});

describe("jaroWinkler", () => {
  it("scores identical strings 1 and disjoint strings low", () => {
    expect(jaroWinkler("lattice", "lattice")).toBe(1);
    expect(jaroWinkler("lattice", "zzzz")).toBeLessThan(0.5);
  });
});

describe("resolveEntities", () => {
  it("merges exact normKey + type matches across chunks", async () => {
    const result = await resolveEntities([
      occ("Marie Curie", "person", 0),
      occ("the Marie Curie", "person", 1),
      occ("marie curie", "person", 2),
    ]);
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].mentions).toBe(3);
    expect(result.entities[0].sourceChunks).toEqual([0, 1, 2]);
  });

  it("never merges across entity types", async () => {
    const result = await resolveEntities([occ("Paris", "location"), occ("Paris", "person")]);
    expect(result.entities).toHaveLength(2);
  });

  it("fuzzy-merges near-identical surface forms without an embedder", async () => {
    const result = await resolveEntities([occ("reconciliation loop"), occ("reconciliation loops")]);
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].aliases).toHaveLength(1);
  });

  it("picks the most frequent surface form as the canonical label", async () => {
    const result = await resolveEntities([
      occ("M. Curie", "person"),
      occ("Marie Curie", "person"),
      occ("Marie Curie", "person"),
    ]);
    // "M. Curie" and "Marie Curie" may or may not fuzzy-merge; either way the
    // canonical label of the cluster containing "Marie Curie" is the frequent form.
    const label = result.entities.map((e) => e.label);
    expect(label).toContain("Marie Curie");
  });

  it("merges via embedder cosine when one is supplied", async () => {
    // Fake embedder: identical vector for both names → cosine 1.
    const embedder = async (texts: string[]) => texts.map(() => [1, 0, 0]);
    const result = await resolveEntities([occ("global warming"), occ("climate change")], {
      embedder,
    });
    expect(result.entities).toHaveLength(1);
  });

  it("resolves surface forms back to entity ids", async () => {
    const result = await resolveEntities([occ("The Lattice App", "artifact")]);
    expect(result.idFor("the lattice app", "artifact")).toBe(result.entities[0].id);
    expect(result.idFor("unknown thing", "artifact")).toBeUndefined();
  });
});
