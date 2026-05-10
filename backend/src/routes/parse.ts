import { Router, Request, Response } from "express";
import multer from "multer";
import { v4 as uuidv4 } from "uuid";
import { parseReceiptImage } from "../services/openrouter";
import { upsertReceipt } from "../services/db";
import type { Receipt } from "../types";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only JPG, PNG, and WEBP images are accepted"));
    }
  },
});

router.post(
  "/",
  upload.single("image"),
  async (req: Request, res: Response) => {
    if (!req.file) {
      res.status(400).json({ error: "No image file provided" });
      return;
    }

    const imageBase64 = req.file.buffer.toString("base64");
    const mimeType = req.file.mimetype;

    try {
      const parsed = await parseReceiptImage(imageBase64, mimeType);

      const now = new Date().toISOString();
      const receipt: Receipt = {
        id: uuidv4(),
        merchant_name: parsed.merchant_name,
        receipt_date: parsed.receipt_date,
        line_items: parsed.line_items.map((item) => ({
          id: uuidv4(),
          name: item.name,
          amount: item.amount,
        })),
        subtotal: parsed.subtotal,
        tax: parsed.tax,
        tip: parsed.tip,
        total: parsed.total,
        confidence_score: parsed.confidence_score,
        warnings: parsed.warnings,
        imageBase64,
        mimeType,
        originalExtraction: parsed,
        savedAt: null,
        createdAt: now,
      };

      upsertReceipt(receipt);

      const { imageBase64: _img, ...receiptWithoutImage } = receipt;
      res.json(receiptWithoutImage);
    } catch (err) {
      console.error("Parse error:", err);
      res.status(500).json({ error: "Failed to parse receipt" });
    }
  }
);

export default router;
