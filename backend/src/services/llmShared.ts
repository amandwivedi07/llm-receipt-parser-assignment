// Shared LLM plumbing: output schema, parsing, and the model-fallback
// wrapper. The provider file (openrouter.ts) only has to implement the HTTP
// call and feed it to `createParser`. Prompts live in ./prompts.ts and are
// re-exported here so consumers can import everything from one place.
//
// Why only OpenRouter: it gateways to OpenAI, Anthropic, Google, Meta, etc.
// — one HTTP shape, every model. A separate OpenAI client would duplicate
// code without adding capability.
import { z } from "zod";
import type { ParsedReceipt } from "../types";
import { SYSTEM_PROMPT } from "./prompts";

export { SYSTEM_PROMPT };

const LineItemSchema = z.object({
  name: z.string(),
  amount: z.number(),                            // may be negative (discount/refund)
});

// Matches the schema in prompts.ts (Receipt Extraction Engine v1.0).
// snake_case throughout — matches the LLM contract.
export const ParsedReceiptSchema = z.object({
  merchant_name: z.string().nullable(),
  receipt_date: z.string().nullable(),
  line_items: z.array(LineItemSchema),
  subtotal: z.number().nullable(),
  tax: z.number().nullable(),
  tip: z.number().nullable(),
  total: z.number().nullable(),
  confidence_score: z.number().min(0).max(1),
  warnings: z.array(z.string()),
});

export const ALLOWED_MEDIA_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;
export type MediaType = (typeof ALLOWED_MEDIA_TYPES)[number];

export function normalizeMediaType(mimeType: string): MediaType {
  return (ALLOWED_MEDIA_TYPES as readonly string[]).includes(mimeType)
    ? (mimeType as MediaType)
    : "image/jpeg";
}

export function parseJSON(raw: string): ParsedReceipt | null {
  // Strip markdown fences if the model slipped one in.
  const cleaned = raw.replace(/```json|```/g, "").trim();
  try {
    return ParsedReceiptSchema.parse(JSON.parse(cleaned));
  } catch {
    return null;
  }
}

export const FALLBACK_RECEIPT: ParsedReceipt = {
  merchant_name: null,
  receipt_date: null,
  line_items: [],
  subtotal: null,
  tax: null,
  tip: null,
  total: null,
  confidence_score: 0,
  warnings: [
    "extraction_failed: automatic extraction failed — please fill in the fields manually",
  ],
};

export type CallLLM = (
  imageBase64: string,
  mediaType: MediaType,
  systemPrompt: string
) => Promise<string>;

/**
 * Build a parser that tries each caller in sequence.
 *
 * Per caller: one attempt with SYSTEM_PROMPT.
 *
 * Across callers: if a caller throws (network / 4xx / 5xx) or returns
 * unparseable output, we move on to the next caller. This handles "this
 * provider / model is down" without giving up — particularly valuable
 * when the chain mixes models or providers (e.g. GPT-4o → Gemini → Llama),
 * since a different model is much more likely to succeed than retrying
 * the same one that just failed.
 *
 * If every caller is exhausted, return FALLBACK_RECEIPT so the user
 * still lands on the correction UI with a low-confidence skeleton.
 */
export function createMultiParser(callers: CallLLM[]) {
  if (callers.length === 0) {
    throw new Error("createMultiParser requires at least one caller");
  }
  return async function parseReceiptImage(
    imageBase64: string,
    mimeType: string
  ): Promise<ParsedReceipt> {
    const mediaType = normalizeMediaType(mimeType);

    for (let i = 0; i < callers.length; i++) {
      const callLLM = callers[i];
      try {
        const raw = await callLLM(imageBase64, mediaType, SYSTEM_PROMPT);
        const result = parseJSON(raw);
        if (result) return result;

        console.warn(
          `LLM caller #${i} returned unparseable output; falling through.`
        );
      } catch (err) {
        // HTTP / network failure — try the next caller.
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`LLM caller #${i} threw: ${msg}; falling through.`);
      }
    }

    return FALLBACK_RECEIPT;
  };
}

/** Single-caller convenience wrapper around `createMultiParser`. */
export function createParser(callLLM: CallLLM) {
  return createMultiParser([callLLM]);
}
