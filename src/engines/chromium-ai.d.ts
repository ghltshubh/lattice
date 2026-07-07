/**
 * Minimal ambient types for the Chrome Prompt API (built-in Gemini Nano).
 * Hand-written against the current API surface instead of depending on
 * @types/dom-chromium-ai, which lags the fast-moving spec (BUILD_PLAN §11
 * "version drift"). Extend as more of the API is used.
 */

type ChromeAIAvailability = "unavailable" | "downloadable" | "downloading" | "available";

interface ChromeAIPromptOptions {
  responseConstraint?: object;
  signal?: AbortSignal;
}

interface ChromeAILanguageModelSession {
  prompt(input: string, options?: ChromeAIPromptOptions): Promise<string>;
  clone(): Promise<ChromeAILanguageModelSession>;
  destroy(): void;
  readonly inputUsage?: number;
  readonly inputQuota?: number;
  measureInputUsage?(input: string): Promise<number>;
}

interface ChromeAICreateOptions {
  initialPrompts?: { role: "system" | "user" | "assistant"; content: string }[];
  temperature?: number;
  topK?: number;
  signal?: AbortSignal;
  monitor?(m: EventTarget): void;
}

interface ChromeAILanguageModelStatic {
  availability(): Promise<ChromeAIAvailability>;
  create(options?: ChromeAICreateOptions): Promise<ChromeAILanguageModelSession>;
  params?(): Promise<{
    defaultTemperature: number;
    maxTemperature: number;
    defaultTopK: number;
    maxTopK: number;
  } | null>;
}

declare var LanguageModel: ChromeAILanguageModelStatic | undefined;
