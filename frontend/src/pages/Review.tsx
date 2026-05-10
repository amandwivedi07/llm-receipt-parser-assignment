import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import type { Receipt, LineItem } from "../types";
import { LOW_CONFIDENCE_THRESHOLD } from "../types";
import EditableField from "../components/EditableField";
import styles from "./Review.module.css";

function genId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function fmt(n: number | null): string {
  if (n === null) return "";
  return n.toFixed(2);
}

function parseAmount(s: string): number | null {
  // Allow negative numbers — line item amounts may be negative (discounts,
  // refunds), per the LLM contract in prompts.ts.
  const cleaned = s.trim();
  const negative = cleaned.startsWith("-");
  const digits = cleaned.replace(/[^0-9.]/g, "");
  const n = parseFloat(digits);
  if (isNaN(n)) return null;
  return negative ? -n : n;
}

function computeLineTotal(items: LineItem[]): number {
  return items.reduce((sum, item) => sum + item.amount, 0);
}

function recomputeTotal(
  items: LineItem[],
  tax: number | null,
  tip: number | null
): number {
  return computeLineTotal(items) + (tax ?? 0) + (tip ?? 0);
}

// Snapshot = the editable subset of a Receipt, normalized so we can compare
// "what's on screen now" vs "what was last saved" without false positives from
// per-item ids, image data, savedAt, etc.
type Snapshot = {
  merchant_name: string | null;
  receipt_date: string | null;
  subtotal: number | null;
  tax: number | null;
  tip: number | null;
  total: number | null;
  line_items: { name: string; amount: number }[];
};

function snapshot(r: Receipt): Snapshot {
  return {
    merchant_name: r.merchant_name,
    receipt_date: r.receipt_date,
    subtotal: r.subtotal,
    tax: r.tax,
    tip: r.tip,
    total: r.total,
    line_items: r.line_items.map(({ name, amount }) => ({ name, amount })),
  };
}

function snapshotsEqual(a: Snapshot, b: Snapshot): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export default function ReviewPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [image, setImage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  // Baseline for "have they edited anything since the last persisted state?"
  // Initialized on load, refreshed on successful save.
  const [lastSaved, setLastSaved] = useState<Snapshot | null>(null);
  // Subtotal and total are always derived (display-only):
  //   subtotal = sum(line_items)
  //   total    = subtotal + tax + tip
  // The user edits line items / tax / tip; subtotal and total follow.

  useEffect(() => {
    if (!id) return;
    Promise.all([
      fetch(`/api/receipts/${id}`).then((r) => r.json()),
      fetch(`/api/receipts/${id}/image`).then((r) => r.json()),
    ])
      .then(([r, img]) => {
        // Normalize on load: replace the LLM's subtotal/total with the
        // computed values so display + persisted state are consistent.
        const computedSubtotal = computeLineTotal(r.line_items);
        const computedTotal =
          computedSubtotal + (r.tax ?? 0) + (r.tip ?? 0);
        const normalized: Receipt = {
          ...r,
          subtotal: computedSubtotal,
          total: computedTotal,
        };
        setReceipt(normalized);
        setImage(img.imageBase64 || null);
        setLastSaved(snapshot(normalized));
        setLoading(false);
      })
      .catch(() => {
        setError("Could not load receipt.");
        setLoading(false);
      });
  }, [id]);

  // ── Unsaved-changes tracking (must run before early returns) ─────
  const hasUnsavedChanges =
    !!receipt && !!lastSaved && !snapshotsEqual(snapshot(receipt), lastSaved);

  // Warn the user if they try to refresh / close the tab with unsaved edits.
  // `preventDefault()` alone is sufficient in modern browsers; we drop the
  // deprecated `returnValue` assignment.
  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [hasUnsavedChanges]);

  if (loading) return <div className={styles.loading}>Loading…</div>;
  if (error || !receipt)
    return <div className={styles.loading}>{error || "Not found"}</div>;

  // ── Derived values ───────────────────────────────────────────────
  const lineTotal = computeLineTotal(receipt.line_items);
  const computedTotal = lineTotal + (receipt.tax ?? 0) + (receipt.tip ?? 0);
  const isLowConfidence = receipt.confidence_score < LOW_CONFIDENCE_THRESHOLD;

  // ── Field updaters ───────────────────────────────────────────────
  // Helper: rebuild the receipt with subtotal + total recomputed from the
  // (possibly updated) line_items, tax, and tip values.
  function withDerivedTotals(
    r: Receipt,
    overrides: Partial<Pick<Receipt, "line_items" | "tax" | "tip">>
  ): Receipt {
    const next = { ...r, ...overrides };
    const subtotal = computeLineTotal(next.line_items);
    const total = subtotal + (next.tax ?? 0) + (next.tip ?? 0);
    return { ...next, subtotal, total };
  }

  function setMerchantName(v: string) {
    setReceipt((r) => r && { ...r, merchant_name: v || null });
  }
  function setReceiptDate(v: string) {
    setReceipt((r) => r && { ...r, receipt_date: v || null });
  }
  function setTax(v: string) {
    const tax = parseAmount(v);
    setReceipt((r) => r && withDerivedTotals(r, { tax }));
  }
  function setTip(v: string) {
    const tip = parseAmount(v);
    setReceipt((r) => r && withDerivedTotals(r, { tip }));
  }
  function setLineItemName(itemId: string, name: string) {
    setReceipt(
      (r) =>
        r && {
          ...r,
          line_items: r.line_items.map((li) =>
            li.id === itemId ? { ...li, name } : li
          ),
        }
    );
  }
  function setLineItemAmount(itemId: string, v: string) {
    const amount = parseAmount(v) ?? 0;
    setReceipt((r) => {
      if (!r) return r;
      const line_items = r.line_items.map((li) =>
        li.id === itemId ? { ...li, amount } : li
      );
      return withDerivedTotals(r, { line_items });
    });
  }
  function addLineItem() {
    const newItem: LineItem = { id: genId(), name: "", amount: 0 };
    setReceipt(
      (r) => r && withDerivedTotals(r, { line_items: [...r.line_items, newItem] })
    );
  }
  function removeLineItem(itemId: string) {
    setReceipt((r) => {
      if (!r) return r;
      const line_items = r.line_items.filter((li) => li.id !== itemId);
      return withDerivedTotals(r, { line_items });
    });
  }

  // ── Save ─────────────────────────────────────────────────────────
  async function handleSave() {
    if (!receipt) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/receipts/${receipt.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          merchant_name: receipt.merchant_name,
          receipt_date: receipt.receipt_date,
          line_items: receipt.line_items,
          subtotal: receipt.subtotal,
          tax: receipt.tax,
          tip: receipt.tip,
          total: receipt.total,
        }),
      });
      if (!res.ok) throw new Error("Save failed");
      // Merge the server's view of the saved receipt back in (notably savedAt).
      // imageBase64 isn't in the response, so the spread keeps our local copy.
      const updated = (await res.json()) as Partial<Receipt>;
      const merged = { ...receipt, ...updated };
      setReceipt(merged);
      setLastSaved(snapshot(merged));
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch {
      setError("Failed to save. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  // ── Diff helpers ─────────────────────────────────────────────────
  // These run inside the component after the `if (!receipt) return ...`
  // guard, so `receipt` is non-null here.
  function wasChanged(field: string, currentVal: string | number | null): boolean {
    const orig = receipt!.originalExtraction as unknown as Record<string, unknown>;
    return String(orig[field]) !== String(currentVal);
  }

  // Line items don't carry stable ids on the original extraction,
  // so we match by index. False positives if the user inserts/removes in the
  // middle — acceptable for v1 since the UI has no reorder.
  type LineItemChange = "unchanged" | "edited" | "new";
  function lineItemChange(
    idx: number,
    current: { name: string; amount: number }
  ): LineItemChange {
    const orig = receipt!.originalExtraction.line_items[idx];
    if (!orig) return "new";
    if (orig.name !== current.name || orig.amount !== current.amount) {
      return "edited";
    }
    return "unchanged";
  }

  return (
    <div className={styles.page}>
      {/* Header */}
      <header className={styles.header}>
        <button
          className={styles.backBtn}
          onClick={() => {
            if (
              hasUnsavedChanges &&
              !window.confirm("You have unsaved changes. Leave anyway?")
            ) {
              return;
            }
            navigate("/");
          }}
        >
          ← New upload
        </button>
        <span className={styles.logo}>RECEIPT PARSER</span>
        <button
          className={[styles.saveBtn, saved && styles.savedBtn].filter(Boolean).join(" ")}
          onClick={handleSave}
          disabled={saving}
        >
          {saving
            ? "Saving…"
            : saved
            ? "✓ Saved"
            : hasUnsavedChanges
            ? "Save changes"
            : "Save receipt"}
        </button>
      </header>

      {/* Confidence + warnings banner */}
      {(isLowConfidence || receipt.warnings.length > 0) && (
        <div
          className={
            isLowConfidence ? styles.warnBanner : styles.notesBanner
          }
        >
          <span className={styles.warnIcon}>{isLowConfidence ? "⚠" : "ℹ"}</span>
          <span>
            {isLowConfidence ? (
              <>
                <strong>
                  Low confidence extraction (
                  {Math.round(receipt.confidence_score * 100)}%)
                </strong>{" "}
                — please review carefully before saving.
              </>
            ) : (
              <strong>Heads up</strong>
            )}
            {receipt.warnings.length > 0 && (
              <ul className={styles.warnList}>
                {receipt.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            )}
          </span>
        </div>
      )}

      <div className={styles.layout}>
        {/* Left: original image */}
        <aside className={styles.imagePane}>
          <p className={styles.panelLabel}>ORIGINAL IMAGE</p>
          {image ? (
            <img
              src={`data:${receipt.mimeType ?? "image/jpeg"};base64,${image}`}
              alt="Receipt"
              className={styles.receiptImage}
            />
          ) : (
            <div className={styles.noImage}>No image available</div>
          )}
          <p className={styles.imageHint}>
            Cross-check the fields on the right against this image
          </p>
        </aside>

        {/* Right: editable fields */}
        <main className={styles.fieldsPane}>
          <p className={styles.panelLabel}>EXTRACTED DATA — CLICK ANY FIELD TO EDIT</p>

          {/* Merchant + Date */}
          <div className={styles.metaRow}>
            <div className={styles.fieldGroup}>
              <label className={styles.fieldLabel}>
                MERCHANT
                {wasChanged("merchant_name", receipt.merchant_name) && (
                  <span className={styles.editedBadge}>edited</span>
                )}
              </label>
              <EditableField
                value={receipt.merchant_name ?? ""}
                placeholder="Unknown merchant"
                onChange={setMerchantName}
                highlight={!receipt.merchant_name}
              />
            </div>
            <div className={styles.fieldGroup}>
              <label className={styles.fieldLabel}>
                DATE
                {wasChanged("receipt_date", receipt.receipt_date) && (
                  <span className={styles.editedBadge}>edited</span>
                )}
              </label>
              <EditableField
                value={receipt.receipt_date ?? ""}
                placeholder="YYYY-MM-DD"
                onChange={setReceiptDate}
                type="date"
                highlight={!receipt.receipt_date}
              />
            </div>
          </div>

          {/* Line items */}
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <span className={styles.sectionTitle}>LINE ITEMS</span>
              <button className={styles.addBtn} onClick={addLineItem}>
                + Add item
              </button>
            </div>

            {receipt.line_items.length === 0 && (
              <div className={styles.emptyItems}>
                No items extracted — add them manually
              </div>
            )}

            <div className={styles.itemsTable}>
              {receipt.line_items.map((item, idx) => {
                const change = lineItemChange(idx, item);
                return (
                <div key={item.id} className={styles.itemRow}>
                  <span className={styles.itemIndex}>{idx + 1}</span>
                  <div className={styles.itemName}>
                    <EditableField
                      value={item.name}
                      placeholder="Item name"
                      onChange={(v) => setLineItemName(item.id, v)}
                      highlight={!item.name}
                    />
                    {change === "edited" && (
                      <span className={styles.editedBadge}>edited</span>
                    )}
                    {change === "new" && (
                      <span className={styles.editedBadge}>new</span>
                    )}
                  </div>
                  <div className={styles.itemAmount}>
                    <EditableField
                      value={fmt(item.amount)}
                      placeholder="0.00"
                      onChange={(v) => setLineItemAmount(item.id, v)}
                      align="right"
                      prefix="₹"
                      highlight={item.amount === 0}
                    />
                  </div>
                  <button
                    className={styles.removeBtn}
                    onClick={() => removeLineItem(item.id)}
                    title="Remove item"
                  >
                    ×
                  </button>
                </div>
                );
              })}
            </div>

            {/* Subtotals */}
            <div className={styles.totalsBlock}>
              <div className={styles.totalRow}>
                <span className={styles.totalLabel}>Subtotal</span>
                <span className={styles.totalValue}>
                  ₹{lineTotal.toFixed(2)}
                </span>
              </div>
              <div className={styles.totalRow}>
                <span className={styles.totalLabel}>
                  <span>Tax</span>
                  {wasChanged("tax", receipt.tax) && (
                    <span className={styles.editedBadge}>edited</span>
                  )}
                </span>
                <div className={styles.totalInput}>
                  <EditableField
                    value={fmt(receipt.tax)}
                    placeholder="0.00"
                    onChange={setTax}
                    align="right"
                    prefix="₹"
                  />
                </div>
              </div>
              <div className={styles.totalRow}>
                <span className={styles.totalLabel}>
                  <span>Tip</span>
                  {wasChanged("tip", receipt.tip) && (
                    <span className={styles.editedBadge}>edited</span>
                  )}
                </span>
                <div className={styles.totalInput}>
                  <EditableField
                    value={fmt(receipt.tip)}
                    placeholder="0.00"
                    onChange={setTip}
                    align="right"
                    prefix="₹"
                  />
                </div>
              </div>
              <div className={[styles.totalRow, styles.grandTotal].join(" ")}>
                <span className={styles.totalLabel}>TOTAL</span>
                <span
                  className={styles.totalValue}
                  style={{ fontWeight: 600, fontSize: "14px" }}
                >
                  ₹{computedTotal.toFixed(2)}
                </span>
              </div>
            </div>
          </div>

          {/* Original extraction diff */}
          <details className={styles.diffBlock}>
            <summary className={styles.diffSummary}>
              What was originally extracted
            </summary>
            <div className={styles.diffTable}>
              <div className={styles.diffRow}>
                <span className={styles.diffKey}>Merchant</span>
                <span className={styles.diffVal}>
                  {receipt.originalExtraction.merchant_name ?? "—"}
                </span>
              </div>
              <div className={styles.diffRow}>
                <span className={styles.diffKey}>Date</span>
                <span className={styles.diffVal}>
                  {receipt.originalExtraction.receipt_date ?? "—"}
                </span>
              </div>
              <div className={styles.diffRow}>
                <span className={styles.diffKey}>Total</span>
                <span className={styles.diffVal}>
                  {receipt.originalExtraction.total !== null
                    ? `₹${receipt.originalExtraction.total.toFixed(2)}`
                    : "—"}
                </span>
              </div>
              <div className={styles.diffRow}>
                <span className={styles.diffKey}>Confidence</span>
                <span className={styles.diffVal}>
                  {Math.round(
                    receipt.originalExtraction.confidence_score * 100
                  )}
                  %
                </span>
              </div>
              {receipt.originalExtraction.warnings.length > 0 && (
                <div className={styles.diffRow}>
                  <span className={styles.diffKey}>Warnings</span>
                  <span className={styles.diffVal}>
                    <ul className={styles.warnList}>
                      {receipt.originalExtraction.warnings.map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  </span>
                </div>
              )}
            </div>
          </details>

          {error && <div className={styles.saveError}>{error}</div>}
        </main>
      </div>
    </div>
  );
}
