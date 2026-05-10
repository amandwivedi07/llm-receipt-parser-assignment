import fs from "fs";
import path from "path";
import type { Receipt } from "../types";

const DATA_DIR = path.join(__dirname, "../../data");
const DB_PATH = path.join(DATA_DIR, "receipts.json");

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readAll(): Record<string, Receipt> {
  if (!fs.existsSync(DB_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, "utf-8"));
  } catch {
    return {};
  }
}

function writeAll(data: Record<string, Receipt>): void {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), "utf-8");
}

export function upsertReceipt(receipt: Receipt): void {
  const all = readAll();
  all[receipt.id] = receipt;
  writeAll(all);
}

export function getReceiptById(id: string): Receipt | null {
  const all = readAll();
  return all[id] ?? null;
}

export function getAllReceipts(): Receipt[] {
  const all = readAll();
  return Object.values(all).sort(
    (a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}
