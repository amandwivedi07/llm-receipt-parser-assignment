import { z } from "zod";
import type { ParsedReceipt } from "../types";
import { SYSTEM_PROMPT } from "./prompts";

export { SYSTEM_PROMPT };

const LineItemSchema = z.object({
  name: z.string(),
  amount: z.number(),
});

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
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`LLM caller #${i} threw: ${msg}; falling through.`);
      }
    }

    return FALLBACK_RECEIPT;
  };
}

export function createParser(callLLM: CallLLM) {
  return createMultiParser([callLLM]);
}
