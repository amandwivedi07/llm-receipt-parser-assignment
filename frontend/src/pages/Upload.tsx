import { useState, useRef, DragEvent, ChangeEvent } from "react";
import { useNavigate, Link } from "react-router-dom";
import styles from "./Upload.module.css";

type UploadState = "idle" | "dragging" | "uploading" | "error";

export default function UploadPage() {
  const [state, setState] = useState<UploadState>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  async function handleFile(file: File) {
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setErrorMsg("Only JPG, PNG, or WEBP images are accepted.");
      setState("error");
      return;
    }

    // Show preview
    const reader = new FileReader();
    reader.onload = (e) => setPreview(e.target?.result as string);
    reader.readAsDataURL(file);

    setState("uploading");
    setErrorMsg("");

    const formData = new FormData();
    formData.append("image", file);

    try {
      const res = await fetch("/api/parse", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error || "Upload failed");
      }

      const receipt = await res.json();
      navigate(`/review/${receipt.id}`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Something went wrong");
      setState("error");
    }
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setState("idle");
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  function onDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setState("dragging");
  }

  function onDragLeave() {
    setState("idle");
  }

  function onInputChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <span className={styles.logo}>RECEIPT PARSER</span>
        <Link to="/history" className={styles.historyLink}>
          View saved →
        </Link>
      </header>

      <main className={styles.main}>
        <div className={styles.intro}>
          <h1 className={styles.title}>Upload a receipt</h1>
          <p className={styles.subtitle}>
            Drop a photo and we'll extract the line items, total, and merchant
            info. You can correct anything before saving.
          </p>
        </div>

        <div
          className={[
            styles.dropzone,
            state === "dragging" && styles.dragging,
            state === "uploading" && styles.uploading,
            state === "error" && styles.errored,
          ]
            .filter(Boolean)
            .join(" ")}
          onDrop={onDrop}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onClick={() => state === "idle" && fileRef.current?.click()}
        >
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={onInputChange}
            style={{ display: "none" }}
          />

          {state === "uploading" ? (
            <div className={styles.uploading_inner}>
              {preview && (
                <img src={preview} alt="Receipt preview" className={styles.preview} />
              )}
              <div className={styles.spinner} />
              <p className={styles.uploadingText}>
                Parsing receipt…
              </p>
            </div>
          ) : (
            <div className={styles.idle_inner}>
              <div className={styles.icon}>
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="17 8 12 3 7 8"/>
                  <line x1="12" y1="3" x2="12" y2="15"/>
                </svg>
              </div>
              <p className={styles.dropText}>
                {state === "dragging"
                  ? "Drop it"
                  : "Drop a receipt photo here"}
              </p>
              <p className={styles.orText}>or</p>
              <button
                className={styles.browseBtn}
                onClick={(e) => {
                  e.stopPropagation();
                  fileRef.current?.click();
                }}
              >
                Browse files
              </button>
              <p className={styles.hint}>JPG, PNG, WEBP · max 10MB</p>
            </div>
          )}
        </div>

        {state === "error" && (
          <div className={styles.error}>
            <strong>Error:</strong> {errorMsg}
            <button
              className={styles.retryBtn}
              onClick={() => {
                setState("idle");
                setPreview(null);
              }}
            >
              Try again
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
