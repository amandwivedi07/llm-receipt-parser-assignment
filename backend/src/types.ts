// LLM-output fields use snake_case (matches the prompt schema contract).
// Wrapper fields (id, imageBase64, savedAt, etc.) stay camelCase.

export type LineItem = {
  id: string;
  name: string;
  amount: number;            // may be negative (discounts, refunds)
};

// Raw shape that comes back from the LLM, validated by ParsedReceiptSchema.
export type ParsedReceipt = {
  merchant_name: string | null;
  receipt_date: string | null;        // YYYY-MM-DD or null
  line_items: { name: string; amount: number }[];
  subtotal: number | null;
  tax: number | null;
  tip: number | null;
  total: number | null;
  confidence_score: number;           // float 0.0 – 1.0
  warnings: string[];                 // empty array if none
};

export type Receipt = {
  id: string;                         // wrapper: server-minted UUID
  merchant_name: string | null;       // LLM
  receipt_date: string | null;        // LLM
  line_items: LineItem[];             // LLM (id-stamped on the wrapper)
  subtotal: number | null;            // LLM
  tax: number | null;                 // LLM
  tip: number | null;                 // LLM
  total: number | null;               // LLM
  confidence_score: number;           // LLM
  warnings: string[];                 // LLM
  imageBase64: string;                // wrapper: stored for cross-reference
  mimeType?: string;                  // wrapper: e.g. "image/png"
  originalExtraction: ParsedReceipt;  // wrapper: snapshot for diff
  savedAt: string | null;             // wrapper: ISO timestamp once user saves
  createdAt: string;                  // wrapper: ISO timestamp at parse time
};
