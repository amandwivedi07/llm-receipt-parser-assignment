import { createMultiParser, type CallLLM } from "./llmShared";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

/**
 * Build a `CallLLM` for one specific OpenRouter model.
 *
 * Exported so callers can compose a model-fallback chain — e.g. try
 * `openai/gpt-4o-mini` first, fall back to `google/gemini-flash-1.5`
 * if that fails.
 */
const DEFAULT_TIMEOUT_MS = 15000;

export function makeOpenRouterCaller(model: string): CallLLM {
  return async (imageBase64, mediaType, systemPrompt) => {
    // Read env at call time (not module-load) so tests / late dotenv loads work.
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new Error("OPENROUTER_API_KEY is not set");
    }
    const timeoutMs = Number(process.env.OPENROUTER_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    };
    if (process.env.OPENROUTER_REFERER) {
      headers["HTTP-Referer"] = process.env.OPENROUTER_REFERER;
    }
    if (process.env.OPENROUTER_TITLE) {
      headers["X-Title"] = process.env.OPENROUTER_TITLE;
    }

    let res: Response;
    try {
      res = await fetch(OPENROUTER_URL, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model,
          max_tokens: 1024,
          messages: [
            { role: "system", content: systemPrompt },
            {
              role: "user",
              content: [
                {
                  type: "image_url",
                  image_url: { url: `data:${mediaType};base64,${imageBase64}` },
                },
                { type: "text", text: "Parse this receipt and return the JSON." },
              ],
            },
          ],
        }),
        // Composes with the model-fallback chain: a timeout throws an AbortError
        // here, `createMultiParser` catches it and tries the next model.
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      // Re-throw with a clearer message so logs/UI know it was a timeout vs.
      // a network error vs. something else.
      if (err instanceof Error && err.name === "TimeoutError") {
        throw new Error(`OpenRouter[${model}] timed out after ${timeoutMs}ms`);
      }
      throw err;
    }

    if (!res.ok) {
      throw new Error(`OpenRouter[${model}] ${res.status}: ${await res.text()}`);
    }

    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    return json.choices?.[0]?.message?.content?.trim() ?? "";
  };
}

/**
 * Default entry point. Builds the model-fallback chain at call time from:
 *   - OPENROUTER_MODEL              (primary, defaults to openai/gpt-4o-mini)
 *   - OPENROUTER_FALLBACK_MODELS    (comma-separated list, optional)
 *
 * Example .env:
 *   OPENROUTER_MODEL=openai/gpt-4o-mini
 *   OPENROUTER_FALLBACK_MODELS=google/gemini-2.0-flash-001,qwen/qwen3-vl-235b-a22b-instruct
 *
 * ── How the try/catch chain actually flows ─────────────────────────────
 * `createMultiParser(callers)` runs roughly:
 *
 *   for each model in [primary, ...fallbacks]:
 *     try {
 *       call the model with SYSTEM_PROMPT — if it parses, return.
 *       (model returned unparseable text — fall through to next model)
 *     } catch (err) {
 *       (HTTP error / timeout / network — fall through to next model)
 *     }
 *   return FALLBACK_RECEIPT (low-confidence skeleton)
 *
 * So with the .env above:
 *   1. Try openai/gpt-4o-mini.       Throws or fails parse?  → step 2.
 *   2. Try google/gemini-2.0-flash.  Throws or fails parse?  → step 3.
 *   3. Try qwen/qwen3-vl-235b.       Throws or fails parse?  → step 4.
 *   4. Return FALLBACK_RECEIPT.      User still gets the correction UI.
 *
 * The per-fetch try/catch lives inside `makeOpenRouterCaller` (line ~30);
 * the cross-model try/catch lives inside `createMultiParser` (llmShared.ts).
 * ──────────────────────────────────────────────────────────────────────
 *
 * Built each call so env updates take effect without a restart (cheap).
 */
export const parseReceiptImage = (imageBase64: string, mimeType: string) => {
  const primary = process.env.OPENROUTER_MODEL ?? "openai/gpt-4o-mini";
  const fallbacks = (process.env.OPENROUTER_FALLBACK_MODELS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const callers = [primary, ...fallbacks].map(makeOpenRouterCaller);
  return createMultiParser(callers)(imageBase64, mimeType);
};
