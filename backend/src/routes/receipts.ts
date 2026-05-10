import { Router, Request, Response } from "express";
import { z } from "zod";
import { getAllReceipts, getReceiptById, upsertReceipt } from "../services/db";
import type { Receipt } from "../types";

const router = Router();

// Editable subset of a Receipt. Every field optional so this works as a PATCH:
// omit a field to leave it alone, send `null` to clear it explicitly.
// `.strict()` rejects fields the client shouldn't be setting (id, confidence,
// imageBase64, originalExtraction, savedAt, createdAt).
const LineItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  amount: z.number(),
});

const UpdateBodySchema = z
  .object({
    merchant_name: z.string().nullable().optional(),
    receipt_date: z.string().nullable().optional(),
    line_items: z.array(LineItemSchema).optional(),
    subtotal: z.number().nullable().optional(),
    tax: z.number().nullable().optional(),
    tip: z.number().nullable().optional(),
    total: z.number().nullable().optional(),
  })
  .strict();

// GET /api/receipts — list all SAVED receipts (without images, for performance).
// Drafts (savedAt === null) are excluded — that covers both abandoned uploads
// and failed-parse fallbacks. They're still reachable by direct id, so the
// Review page works for a fresh upload before the user clicks Save.
router.get("/", (_req: Request, res: Response) => {
  const receipts = getAllReceipts().filter((r) => r.savedAt !== null);
  const light = receipts.map(({ imageBase64: _img, ...r }) => r);
  res.json(light);
});

// GET /api/receipts/:id — full receipt including image
router.get("/:id", (req: Request, res: Response) => {
  const receipt = getReceiptById(req.params.id);
  if (!receipt) {
    res.status(404).json({ error: "Receipt not found" });
    return;
  }
  res.json(receipt);
});

// GET /api/receipts/:id/image — just the base64 image
router.get("/:id/image", (req: Request, res: Response) => {
  const receipt = getReceiptById(req.params.id);
  if (!receipt) {
    res.status(404).json({ error: "Receipt not found" });
    return;
  }
  res.json({ imageBase64: receipt.imageBase64 });
});

// POST /api/receipts/:id — save corrected version
router.post("/:id", (req: Request, res: Response) => {
  const existing = getReceiptById(req.params.id);
  if (!existing) {
    res.status(404).json({ error: "Receipt not found" });
    return;
  }

  const parsed = UpdateBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request body",
      details: parsed.error.issues,
    });
    return;
  }
  const b = parsed.data;

  // Rule: `undefined` means "field not sent — keep what's stored".
  // `null` is a real value (user cleared the field) and must be persisted.
  // Applied uniformly so clearing the merchant works the same way as clearing tax.
  const updated: Receipt = {
    ...existing,
    merchant_name: b.merchant_name !== undefined ? b.merchant_name : existing.merchant_name,
    receipt_date: b.receipt_date !== undefined ? b.receipt_date : existing.receipt_date,
    line_items: b.line_items !== undefined ? b.line_items : existing.line_items,
    subtotal: b.subtotal !== undefined ? b.subtotal : existing.subtotal,
    tax: b.tax !== undefined ? b.tax : existing.tax,
    tip: b.tip !== undefined ? b.tip : existing.tip,
    total: b.total !== undefined ? b.total : existing.total,
    savedAt: new Date().toISOString(),
  };

  upsertReceipt(updated);

  const { imageBase64: _img, ...withoutImage } = updated;
  res.json(withoutImage);
});

export default router;
