/**
 * Extraction JSON Schema (BUILD_PLAN §4). The same schema drives both engines
 * (`responseConstraint` on Prompt API, `json_schema` on WebLLM).
 * Keep it flat and small — on Prompt API the schema itself consumes context.
 */

const ENTITY_TYPES = [
  "person",
  "organization",
  "location",
  "concept",
  "event",
  "artifact",
  "quantity",
  "time",
  "other",
];

const entity = {
  type: "object",
  properties: {
    name: { type: "string" },
    type: { type: "string", enum: ENTITY_TYPES },
  },
  required: ["name", "type"],
};

export const EXTRACTION_SCHEMA = {
  type: "object",
  properties: {
    propositions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          text: { type: "string" },
          subject: entity,
          predicate: { type: "string" },
          object: entity,
        },
        required: ["id", "text", "subject", "predicate", "object"],
      },
    },
  },
  required: ["propositions"],
} as const;
