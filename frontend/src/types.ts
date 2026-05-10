// Mirrors backend/src/types.ts (snake_case for LLM-output fields).

export type LineItem = {
  id: string;
  name: string;
  amount: number;            // may be negative (discounts, refunds)
};

export type ParsedReceipt = {
  merchant_name: string | null;
  receipt_date: string | null;
  line_items: { name: string; amount: number }[];
  subtotal: number | null;
  tax: number | null;
  tip: number | null;
  total: number | null;
  confidence_score: number;
  warnings: string[];
};

export type Receipt = {
  id: string;
  merchant_name: string | null;
  receipt_date: string | null;
  line_items: LineItem[];
  subtotal: number | null;
  tax: number | null;
  tip: number | null;
  total: number | null;
  confidence_score: number;
  warnings: string[];
  imageBase64?: string;
  mimeType?: string;
  originalExtraction: ParsedReceipt;
  savedAt: string | null;
  createdAt: string;
};

// UI threshold: anything below this is rendered as a low-confidence warning.
export const LOW_CONFIDENCE_THRESHOLD = 0.7;
