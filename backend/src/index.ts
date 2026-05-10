import "dotenv/config";
import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import multer from "multer";
import parseRouter from "./routes/parse";
import receiptsRouter from "./routes/receipts";

if (!process.env.OPENROUTER_API_KEY) {
  console.error("ERROR: OPENROUTER_API_KEY is not set. Check your .env file.");
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: "http://localhost:5173" }));
app.use(express.json({ limit: "15mb" }));

app.use("/api/parse", parseRouter);
app.use("/api/receipts", receiptsRouter);

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use(
  (err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (err instanceof multer.MulterError) {
      const msg =
        err.code === "LIMIT_FILE_SIZE"
          ? "Image is too large (max 10MB)"
          : err.message;
      res.status(400).json({ error: msg });
      return;
    }
    if (err instanceof Error && err.message.startsWith("Only ")) {
      res.status(400).json({ error: err.message });
      return;
    }
    if (err) {
      console.error("Unhandled error:", err);
      res.status(500).json({ error: "Internal server error" });
      return;
    }
    next();
  }
);

app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
});
