/** chars/4 heuristic (BUILD_PLAN §7) — guardrail estimate, not an exact count. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** 10-page guardrail: past this estimate the UI warns before running. */
export const TOKEN_GUARDRAIL = 9000;
