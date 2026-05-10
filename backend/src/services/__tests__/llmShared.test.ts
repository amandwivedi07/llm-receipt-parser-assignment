// Tests for the LLM service plumbing — the layer between an unpredictable
// vision model and the user's UI. These cover the behaviors that real
// production failures would trip on: malformed JSON, wrong shape, prompt
// regression, and the model-fallback contract.
import { describe, it, expect, vi } from "vitest";
import {
  parseJSON,
  createParser,
  createMultiParser,
  normalizeMediaType,
  
  SYSTEM_PROMPT,
  FALLBACK_RECEIPT,
} from "../llmShared";

const VALID_JSON = JSON.stringify({
  merchant_name: "Test Cafe",
  receipt_date: "2026-05-09",
  line_items: [{ name: "Latte", amount: 4.5 }],
  subtotal: 4.5,
  tax: 0.45,
  tip: 1.0,
  total: 5.95,
  confidence_score: 0.95,
  warnings: [],
});

describe("parseJSON", () => {
  it("returns the validated object for clean JSON", () => {
    const out = parseJSON(VALID_JSON);
    expect(out).not.toBeNull();
    expect(out?.merchant_name).toBe("Test Cafe");
    expect(out?.line_items).toHaveLength(1);
    expect(out?.confidence_score).toBe(0.95);
  });

  it("strips ```json fences before parsing", () => {
    const wrapped = "```json\n" + VALID_JSON + "\n```";
    expect(parseJSON(wrapped)).not.toBeNull();
  });

  it("strips bare ``` fences", () => {
    const wrapped = "```\n" + VALID_JSON + "\n```";
    expect(parseJSON(wrapped)).not.toBeNull();
  });

  it("returns null for invalid JSON", () => {
    expect(parseJSON("not json at all")).toBeNull();
  });

  it("returns null when the shape doesn't match the schema", () => {
    const wrongShape = JSON.stringify({ merchant_name: "X" }); // missing required fields
    expect(parseJSON(wrongShape)).toBeNull();
  });

  it("returns null when confidence_score is outside [0, 1]", () => {
    const bad = JSON.stringify({
      ...JSON.parse(VALID_JSON),
      confidence_score: 1.5,
    });
    expect(parseJSON(bad)).toBeNull();
  });

  it("accepts negative line item amounts (discounts/refunds)", () => {
    const withDiscount = JSON.stringify({
      ...JSON.parse(VALID_JSON),
      line_items: [
        { name: "Latte", amount: 4.5 },
        { name: "Discount", amount: -1.0 },
      ],
    });
    const out = parseJSON(withDiscount);
    expect(out?.line_items[1].amount).toBe(-1);
  });
});

describe("normalizeMediaType", () => {
  it("returns the input for allowed types", () => {
    expect(normalizeMediaType("image/png")).toBe("image/png");
    expect(normalizeMediaType("image/webp")).toBe("image/webp");
    expect(normalizeMediaType("image/jpeg")).toBe("image/jpeg");
  });

  it("falls back to jpeg for anything else", () => {
    expect(normalizeMediaType("application/pdf")).toBe("image/jpeg");
    expect(normalizeMediaType("")).toBe("image/jpeg");
  });
});

describe("createParser", () => {
  it("returns parsed data on the first attempt and only calls the LLM once", async () => {
    const callLLM = vi.fn().mockResolvedValueOnce(VALID_JSON);
    const parse = createParser(callLLM);
    const out = await parse("base64", "image/jpeg");
    expect(out.merchant_name).toBe("Test Cafe");
    expect(callLLM).toHaveBeenCalledTimes(1);
    expect(callLLM).toHaveBeenCalledWith("base64", "image/jpeg", SYSTEM_PROMPT);
  });

  it("returns the low-confidence fallback when the only caller's output is unparseable", async () => {
    const callLLM = vi.fn().mockResolvedValue("still not json");
    const parse = createParser(callLLM);
    const out = await parse("base64", "image/jpeg");
    expect(out).toEqual(FALLBACK_RECEIPT);
    expect(out.confidence_score).toBe(0);
    expect(out.warnings.length).toBeGreaterThan(0);
    expect(callLLM).toHaveBeenCalledTimes(1);
  });

  it("normalizes an unknown mime type to jpeg before calling the LLM", async () => {
    const callLLM = vi.fn().mockResolvedValue(VALID_JSON);
    const parse = createParser(callLLM);
    await parse("base64", "application/octet-stream");
    expect(callLLM).toHaveBeenCalledWith("base64", "image/jpeg", SYSTEM_PROMPT);
  });
});

describe("createMultiParser", () => {
  it("uses only the first caller when it succeeds", async () => {
    const a = vi.fn().mockResolvedValueOnce(VALID_JSON);
    const b = vi.fn().mockResolvedValueOnce(VALID_JSON);
    const parse = createMultiParser([a, b]);
    const out = await parse("base64", "image/jpeg");
    expect(out.merchant_name).toBe("Test Cafe");
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
  });

  it("falls through to the next caller when the first throws (e.g. 503)", async () => {
    const a = vi.fn().mockRejectedValue(new Error("OpenRouter 503: down"));
    const b = vi.fn().mockResolvedValueOnce(VALID_JSON);
    const parse = createMultiParser([a, b]);
    const out = await parse("base64", "image/jpeg");
    expect(out.merchant_name).toBe("Test Cafe");
    expect(a).toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("falls through after a caller returns unparseable output", async () => {
    const a = vi.fn().mockResolvedValue("garbage from model A");
    const b = vi.fn().mockResolvedValueOnce(VALID_JSON);
    const parse = createMultiParser([a, b]);
    const out = await parse("base64", "image/jpeg");
    expect(out.merchant_name).toBe("Test Cafe");
    expect(a).toHaveBeenCalledTimes(1);
    expect(a).toHaveBeenCalledWith("base64", "image/jpeg", SYSTEM_PROMPT);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("returns FALLBACK_RECEIPT when every caller fails", async () => {
    const a = vi.fn().mockRejectedValue(new Error("network"));
    const b = vi.fn().mockResolvedValue("garbage");
    const c = vi.fn().mockRejectedValue(new Error("503"));
    const parse = createMultiParser([a, b, c]);
    const out = await parse("base64", "image/jpeg");
    expect(out).toEqual(FALLBACK_RECEIPT);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    expect(c).toHaveBeenCalledTimes(1);
  });

  it("throws if constructed with no callers", () => {
    expect(() => createMultiParser([])).toThrow();
  });

  // The actual timeout is enforced in openrouter.ts via
  // AbortSignal.timeout, but its consequence — a thrown error from the
  // caller — is what makes the chain fall through. This confirms the
  // contract: a timeout-shaped throw triggers fallthrough, not a hard
  // failure.
  it("treats a timeout-shaped error like any other throw and falls through", async () => {
    const timeoutError = new Error("OpenRouter[gpt-4o-mini] timed out after 25000ms");
    const a = vi.fn().mockRejectedValue(timeoutError);
    const b = vi.fn().mockResolvedValueOnce(VALID_JSON);
    const parse = createMultiParser([a, b]);
    const out = await parse("base64", "image/jpeg");
    expect(out.merchant_name).toBe("Test Cafe");
    expect(b).toHaveBeenCalledTimes(1);
  });
});
