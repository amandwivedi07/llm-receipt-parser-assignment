import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import type { Receipt } from "../types";
import styles from "./History.module.css";

export default function HistoryPage() {
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    fetch("/api/receipts")
      .then((r) => r.json())
      .then((data) => {
        setReceipts(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <button className={styles.backBtn} onClick={() => navigate("/")}>
          ← New upload
        </button>
        <span className={styles.logo}>RECEIPT PARSER</span>
        <span />
      </header>

      <main className={styles.main}>
        <h1 className={styles.title}>Saved receipts</h1>

        {loading && <p className={styles.empty}>Loading…</p>}
        {!loading && receipts.length === 0 && (
          <p className={styles.empty}>No receipts saved yet.</p>
        )}

        <div className={styles.list}>
          {receipts.map((r) => {
            // Defensive — old/partial rows in the JSON file may be missing
            // some fields. Render gracefully instead of crashing the page.
            const itemCount = r.line_items?.length ?? 0;
            const total = typeof r.total === "number" ? r.total : null;
            return (
              <div
                key={r.id}
                className={styles.card}
                onClick={() => navigate(`/review/${r.id}`)}
              >
                <div className={styles.cardMain}>
                  <span className={styles.merchant}>
                    {r.merchant_name ?? "Unknown merchant"}
                  </span>
                  <span className={styles.date}>
                    {r.receipt_date ?? "No date"}
                  </span>
                </div>
                <div className={styles.cardMeta}>
                  <span className={styles.items}>
                    {itemCount} item{itemCount !== 1 ? "s" : ""}
                  </span>
                  <span className={styles.total}>
                    {total !== null ? `₹${total.toFixed(2)}` : "—"}
                  </span>
                  {r.savedAt ? (
                    <span className={styles.saved}>✓ saved</span>
                  ) : (
                    <span className={styles.unsaved}>unsaved</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}
