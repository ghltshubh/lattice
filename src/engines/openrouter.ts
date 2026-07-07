/**
 * OpenRouterEngine (BUILD_PLAN §8, M7): the High-quality cloud mode.
 * BYOK — the user's key goes browser → openrouter.ai directly and NOWHERE
 * else (§11 "cloud-mode trust"); there is no Lattice server in the path.
 * Selecting this mode is an explicit, warned opt-in (§1a): document text
 * leaves the device.
 */

import type { Availability, ChunkContext, ExtractionEngine, ExtractionResult } from "../core/types";
import { buildUserPrompt, RETRY_PROMPT, SYSTEM_PROMPT, TITLE_PROMPT } from "./prompt";
import { EXTRACTION_SCHEMA } from "./schema";
import { parseExtraction } from "./validate";

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

/**
 * OpenAI-style strict structured outputs demand `additionalProperties: false`
 * on every object; the shared §4 schema omits it (Prompt API and WebLLM don't
 * need it). Derive a strict copy rather than forking the schema by hand.
 */
function strictify(schema: object): object {
  const clone = structuredClone(schema) as Record<string, unknown>;
  const walk = (node: Record<string, unknown>) => {
    if (node.type === "object") {
      node.additionalProperties = false;
      const props = node.properties as Record<string, Record<string, unknown>> | undefined;
      if (props) for (const value of Object.values(props)) walk(value);
    } else if (node.type === "array" && node.items) {
      walk(node.items as Record<string, unknown>);
    }
  };
  walk(clone);
  return clone;
}

const STRICT_EXTRACTION_SCHEMA = strictify(EXTRACTION_SCHEMA);
const AUTH_URL = "https://openrouter.ai/auth";
const KEY_EXCHANGE_URL = "https://openrouter.ai/api/v1/auth/keys";
const VERIFIER_STORAGE = "lattice.orVerifier";
const MAX_RETRIES = 2;

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * OAuth PKCE, step 1: stash a code verifier and send the user to OpenRouter's
 * consent page. They come back to the current URL with ?code=…
 */
export async function startOpenRouterAuth(): Promise<void> {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const verifier = base64url(bytes);
  sessionStorage.setItem(VERIFIER_STORAGE, verifier);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const challenge = base64url(new Uint8Array(digest));
  const callback = `${window.location.origin}${window.location.pathname}`;
  window.location.href = `${AUTH_URL}?callback_url=${encodeURIComponent(callback)}&code_challenge=${challenge}&code_challenge_method=S256`;
}

/**
 * OAuth PKCE, step 2: on page load, exchange a ?code=… (if present) for a
 * user-scoped API key. Returns null when this load isn't an OAuth callback.
 * Cleans the code out of the URL either way.
 */
export async function completeOpenRouterAuth(): Promise<string | null> {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  if (!code) return null;
  params.delete("code");
  const query = params.toString();
  window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
  const verifier = sessionStorage.getItem(VERIFIER_STORAGE);
  sessionStorage.removeItem(VERIFIER_STORAGE);
  if (!verifier) return null; // stale or foreign redirect — ignore
  const res = await fetch(KEY_EXCHANGE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: "S256" }),
  });
  if (!res.ok) throw new Error(`OpenRouter key exchange failed (${res.status})`);
  const data = (await res.json()) as { key?: string };
  return data.key ?? null;
}

/** Editable in the UI — any OpenRouter model id works; this is just a sane cheap default. */
export const DEFAULT_OPENROUTER_MODEL = "openai/gpt-4o-mini";

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export class OpenRouterEngine implements ExtractionEngine {
  readonly id = "openrouter" as const;
  readonly model: string;
  private readonly key: string;
  /** Some models reject json_schema — after one 400 we fall back to plain prompting. */
  private schemaSupported = true;

  constructor(key: string, model: string = DEFAULT_OPENROUTER_MODEL) {
    this.key = key.trim();
    this.model = model.trim() || DEFAULT_OPENROUTER_MODEL;
  }

  async isAvailable(): Promise<Availability> {
    return this.key ? "ready" : "unavailable";
  }

  async init(): Promise<void> {
    if (!this.key) throw new Error("OpenRouter API key missing");
  }

  private async complete(messages: ChatMessage[], constrained = true): Promise<string> {
    const useSchema = constrained && this.schemaSupported;
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.key}`,
        "Content-Type": "application/json",
        "X-Title": "Lattice",
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        temperature: 0,
        ...(useSchema && {
          response_format: {
            type: "json_schema",
            json_schema: { name: "extraction", strict: true, schema: STRICT_EXTRACTION_SCHEMA },
          },
        }),
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      // Model doesn't support structured outputs → retry unconstrained once;
      // parseExtraction still validates everything downstream.
      if (useSchema && res.status === 400) {
        console.warn(`OpenRouter: ${this.model} rejected json_schema, retrying unconstrained`);
        this.schemaSupported = false;
        return this.complete(messages, constrained);
      }
      if (res.status === 401) throw new Error("OpenRouter rejected the API key (401)");
      if (res.status === 402) throw new Error("OpenRouter: insufficient credits (402)");
      if (res.status === 429) throw new Error("OpenRouter: rate limited (429) — try again shortly");
      throw new Error(`OpenRouter error ${res.status}: ${detail.slice(0, 160)}`);
    }
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    return data.choices?.[0]?.message?.content ?? "";
  }

  async extract(chunk: string, ctx: ChunkContext): Promise<ExtractionResult> {
    const messages: ChatMessage[] = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt(chunk, ctx) },
    ];
    let lastRaw = "";
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const raw = await this.complete(messages);
      lastRaw = raw;
      const parsed = parseExtraction(raw);
      if (parsed) return parsed;
      messages.push({ role: "assistant", content: raw }, { role: "user", content: RETRY_PROMPT });
    }
    throw new Error(
      `chunk ${ctx.index}: no valid JSON after ${MAX_RETRIES + 1} attempts: ${lastRaw.slice(0, 120)}`,
    );
  }

  async suggestTitle(excerpt: string): Promise<string> {
    return this.complete([{ role: "user", content: `${TITLE_PROMPT}\n\n${excerpt}` }], false);
  }

  async dispose(): Promise<void> {}
}
