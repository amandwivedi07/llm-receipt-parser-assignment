export type LineItem = {
  id: string;
  name: string;
  amount: number;
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
  imageBase64: string;
  mimeType?: string;
  originalExtraction: ParsedReceipt;
  savedAt: string | null;
  createdAt: string;
};
