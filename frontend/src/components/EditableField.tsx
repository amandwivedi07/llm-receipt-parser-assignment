import { useState, useRef, useEffect } from "react";
import styles from "./EditableField.module.css";

type Props = {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: "text" | "date";
  align?: "left" | "right";
  prefix?: string;
  highlight?: boolean;
  bold?: boolean;
};

export default function EditableField({
  value,
  onChange,
  placeholder = "—",
  type = "text",
  align = "left",
  prefix,
  highlight = false,
  bold = false,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  function commit() {
    setEditing(false);
    onChange(draft);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") commit();
    if (e.key === "Escape") {
      setDraft(value);
      setEditing(false);
    }
  }

  if (editing) {
    return (
      <div className={styles.editingWrapper} style={{ textAlign: align }}>
        {prefix && <span className={styles.prefix}>{prefix}</span>}
        <input
          ref={inputRef}
          type={type}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={handleKeyDown}
          className={[styles.input, bold && styles.bold].filter(Boolean).join(" ")}
          style={{ textAlign: align }}
        />
      </div>
    );
  }

  return (
    <div
      className={[
        styles.display,
        highlight && !value && styles.empty,
        bold && styles.bold,
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ textAlign: align }}
      onClick={() => {
        setDraft(value);
        setEditing(true);
      }}
      title="Click to edit"
    >
      {prefix && value && <span className={styles.prefix}>{prefix}</span>}
      <span className={value ? styles.value : styles.placeholder}>
        {value || placeholder}
      </span>
      <span className={styles.editIcon}>✎</span>
    </div>
  );
}
