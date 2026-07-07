import { describe, expect, it } from "vitest";
import { parseExtraction } from "./validate";

const GOOD = JSON.stringify({
  propositions: [
    {
      id: "p1",
      text: "Marie Curie discovered polonium.",
      subject: { name: "Marie Curie", type: "person" },
      predicate: "discovered",
      object: { name: "polonium", type: "artifact" },
    },
  ],
});

describe("parseExtraction", () => {
  it("parses clean JSON", () => {
    const result = parseExtraction(GOOD);
    expect(result?.propositions).toHaveLength(1);
    expect(result?.propositions[0].subject.name).toBe("Marie Curie");
  });

  it("accepts an empty propositions array (a correct answer, §5)", () => {
    expect(parseExtraction('{"propositions": []}')).toEqual({ propositions: [] });
  });

  it("digs JSON out of markdown fences and prose", () => {
    const wrapped = `Here you go:\n\`\`\`json\n${GOOD}\n\`\`\`\nHope that helps!`;
    expect(parseExtraction(wrapped)?.propositions).toHaveLength(1);
  });

  it('coerces an unknown entity type to "other"', () => {
    const raw = GOOD.replace('"artifact"', '"chemical"');
    expect(parseExtraction(raw)?.propositions[0].object.type).toBe("other");
  });

  it("drops malformed propositions but keeps valid ones", () => {
    const mixed = JSON.stringify({
      propositions: [
        JSON.parse(GOOD).propositions[0],
        { id: "p2", text: "missing everything else" },
        {
          id: "p3",
          text: "",
          subject: { name: "X", type: "other" },
          predicate: "is",
          object: { name: "Y", type: "other" },
        },
      ],
    });
    expect(parseExtraction(mixed)?.propositions).toHaveLength(1);
  });

  it("returns null on garbage (triggers retry upstream)", () => {
    expect(parseExtraction("I could not find any propositions.")).toBeNull();
    expect(parseExtraction("{not json")).toBeNull();
    expect(parseExtraction('{"answer": 42}')).toBeNull();
  });
});
