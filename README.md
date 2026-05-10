# Receipt Parser

Upload a photo of a receipt, get back structured data, review and correct any mistakes inline, save.

## Setup

```bash
git clone <repo> && cd receipt-parser
npm run install:all
cp backend/.env.example backend/.env   # then add your OPENROUTER_API_KEY
npm run dev
```

App runs at **http://localhost:5173**, backend at **http://localhost:3001**.

| Env var | Description |
|---|---|
| `OPENROUTER_API_KEY` | Required |
| `OPENROUTER_MODEL` | Primary model, default `openai/gpt-4o-mini` |
| `OPENROUTER_FALLBACK_MODELS` | Optional comma-separated chain (e.g. `openai/gpt-4o,google/gemini-flash-1.5`) |
| `OPENROUTER_TIMEOUT_MS` | Per-call timeout (default `15000`); on timeout, falls through to next model |
| `PORT` | Backend port (default `3001`) |

Tests: `npm test --prefix backend` (18 vitest cases on the LLM parsing/fallback layer).

---

## What did you build?

A three-page React + Express app: **Upload**, **Review** (where the product lives — photo on the left, editable fields on the right, per-field "edited" / "new" badges against the model's original, auto-computed Subtotal and TOTAL, low-confidence banner with the model's `warnings[]`, unsaved-changes guard), and **History** (saved receipts only). Backend calls a vision LLM through OpenRouter (default `openai/gpt-4o-mini`) with a model-fallback chain, Zod-validates the LLM output and the user's edits, and persists to a JSON file.

## Decisions

The spec called out five decisions to defend. Short answers; details elsewhere in the README.

1. **What is a line item?** Purchased items + named fees only (e.g. "Service charge", "Delivery fee"). Never `subtotal`, `tax`, `tip`, or `total` — those are top-level fields. Reason: `line_items.sum() + tax + tip = total` should hold; mixing aggregate amounts into the array breaks that invariant and double-counts in the auto-computed Subtotal/TOTAL on the Review page.
2. **Malformed LLM output?** Zod-validate the response. If it fails parse, fall through to the next model in the chain. If every model fails (HTTP error, timeout, or unparseable), return a low-confidence skeleton (`FALLBACK_RECEIPT`) so the user lands on the manual-entry form instead of an error screen. Retrying the same model rarely helps; trying a different one usually does.
3. **Low-confidence extractions?** The schema includes a `confidence_score` (0–1, calibrated rubric in the prompt) and a `warnings[]` array. The Review page surfaces a low-confidence banner with the warnings inline so the user knows *which* fields the model was unsure about, not just *that* something was off.
4. **How does the user know what to correct?** Three signals: (a) per-field "edited" / "new" badges against the model's `originalExtraction`, so corrections are visible at a glance, (b) the low-confidence warnings banner, and (c) auto-computed Subtotal/TOTAL that recompute as the user edits line items, so arithmetic mistakes surface immediately.
5. **Which model and why?** `openai/gpt-4o-mini` as primary — the cost/latency profile is right for v1 (sub-2s, ~$0.001/parse) and the accuracy gap vs. larger models on typical printed receipts is small. The human correction UX is the safety net per the spec, so optimizing for cost/latency on the primary makes sense. Fallbacks: `google/gemini-2.0-flash-001` then `qwen/qwen3-vl-235b-a22b-instruct` — different providers so a single-vendor outage doesn't take the app down.

## Biggest tradeoffs

**1. JSON file over SQLite.** Smallest moving part for a single-user local app — no driver, no migrations, easy to inspect, `npm run dev` works on a fresh clone. Real costs: read-the-world per write, non-atomic concurrent writes. Both are bounded at this scope; SQLite migration is the first item I'd pick up if scaling.

**2. OpenRouter gateway with a model-fallback chain.** Going through OpenRouter rather than a single provider's SDK costs one extra hop and a small markup. In return: switching models is one env var, and `OPENROUTER_FALLBACK_MODELS` makes provider outages and rate-limits non-fatal — a transient blip on the primary silently hands off to the next model in the chain. Retrying the same model rarely helps; trying a different one usually does.

**3. Model-fallback chain, then a graceful skeleton.** Any failure on a model — HTTP throw, timeout, or unparseable output — falls through to the next model. After all models exhaust: low-confidence skeleton so the user still lands on the correction UI rather than an error screen. Retrying the same model rarely helps; trying a different one usually does. Failing loudly leaves the user with nothing; failing gracefully means they can fill in fields manually.

## Where did you use an LLM?

- **Chat assistant for prompt iteration** — iterated on the system prompt across several variants. Landed on the line-item rule (purchased items + named fees only — never tax/tip/subtotal/total), the locale-aware date disambiguation (₹/+91/GST → DD/MM/YYYY by default; $ + US state → MM/DD), and the calibrated `confidence_score` rubric.
- **Parsing itself** — OpenRouter, default `openai/gpt-4o-mini`, configurable via env. Structured JSON prompt, Zod-validated, cross-model fallback on any failure (HTTP error, timeout, or unparseable output), graceful skeleton if everything fails.
- **README** — drafted myself. The spec questions are product-judgment questions; boilerplate generation makes them worse.
- **Everything else** (DB layer, the resilience flow, snapshot-based unsaved-changes diff, EditableField behavior, the auto-compute logic for subtotal/total, the per-field "edited"/"new" badges, the multer error middleware, the test suite) — written by hand. The judgment calls are the parts where LLM suggestions tend to be generic.

**Model choice rationale:** `gpt-4o-mini` for the v1 cost/latency profile (sub-2s, ~$0.001/parse). The accuracy gap vs. larger models on typical printed receipts is small, and the human's correction UX is the safety net (per the spec). For tougher receipts, set a stronger model first and keep `mini` as fallback — one env var. The current `.env.example` chains `gpt-4o-mini` → `google/gemini-2.0-flash-001` → `qwen/qwen3-vl-235b-a22b-instruct` so a transient outage on any one provider is non-fatal.

## What would you do with another week?

Top 3:

1. **Image conversion + preprocessing** (`sharp` pipeline) — accept HEIC (currently iPhone users are blocked), downscale to 1600px JPEG, honor EXIF rotation. Single change that fixes four things: HEIC support, ~80% cost cut, ~50% latency cut, simpler mime handling end-to-end.
2. **Detect non-receipt images** (`isReceipt` flag in the schema) — today, a selfie or landscape returns an empty extraction and a confused user. Schema + prompt change + 422 short-circuit.
3. **SQLite migration + filesystem images** — fixes the JSON-file race, removes read-the-world-per-write, and gets receipts.json out of the multi-MB-base64 territory.

Plus **parallel multi-LLM with best-of-N selection** (P1 #4a) — fire all 3 models at once instead of in a serial fallback chain, pick the highest-confidence result, surface model disagreements as warnings. Cuts worst-case latency from ~45s → ~15s (the per-call timeout) and adds free cross-validation, at the cost of 3× per-request spend.

And a **cheap pre-flight classifier** (P1 #4b) — before the expensive vision call, send a 256px thumbnail to a cheap model with a single yes/no prompt: *"is this a receipt?"*. Reject non-receipts in ~500ms for ~10% the cost, instead of running the full extraction on every selfie someone uploads. Net win once ≥10% of uploads are junk.

**Direct provider integrations alongside OpenRouter** — today every call goes through OpenRouter, which is great for breadth (one HTTP shape, every model) but adds a hop, adds a markup, and concentrates risk on a single gateway being up. Plan: add native clients for OpenAI, Anthropic, and Google as parallel `CallLLM` implementations behind the same `createMultiParser` chain. OpenRouter stays as one option among several. Wins: lower latency on the primary, redundancy if OpenRouter itself has an outage, access to provider-specific features (Anthropic's prompt caching, OpenAI's structured outputs) that the gateway doesn't always pass through.

Two production-readiness items I'd queue alongside:
- **DB-backed runtime config** (P2 #14a) — move `system_prompt`, model selection, threshold values from code/env into the DB so prompt iteration and model swaps happen without a deploy. Foundation for A/B testing.
- **Slack integration for LLM monitoring** (P2 #14b, ~1-2 hrs) — webhook on every LLM failure (which model, which error, how long), plus a daily metrics digest. Today we have no live signal for "is the primary model degrading?" — Slack closes that loop.

And a P1.5 batch of small edge-case fixes (atomic write, date validation, empty-save reject, frontend fetch timeout) that are 5–20 min each.

**Per-call timeout tuning** — currently set to 15s (`OPENROUTER_TIMEOUT_MS`, default in `openrouter.ts:12`). Plan: run a batch of real receipts through each model in the chain, measure p50/p95/p99 response times, then re-tune. Likely landing around 20s — high enough that slow-but-successful calls don't get killed prematurely, low enough that worst-case fallthrough across the 3-model chain stays under a minute. Easy to change via env var without redeploying.

Before any of that, I'd want a 15-minute conversation with the PM on the spec gaps I had to default on: real upload size cap, whether we accept HEIC (iPhone default — currently blocked), whether PDF is in scope, how we want to handle currency display + tax-inclusive math, and **multi-currency support — today the parsing pipeline assumes INR (₹) only; a USD/EUR/GBP receipt will still extract numbers but the prompt's locale-aware date and amount conventions are tuned for India, and there's no currency field on the schema to disambiguate. Needs a `currency` field + per-locale prompt branches (or detection) before it can handle mixed-region receipts.** These are product/policy decisions, not engineering ones.

## One thing I'd push back on

> *"The user can edit any field inline and save the corrected version."*

The spec frames correction as a one-way write, but it doesn't say what happens to the model's original output. I made this a first-class concept: every receipt stores `originalExtraction` alongside the user's edits. The Review page surfaces it through per-field "edited"/"new" badges and a collapsible diff — without that record, you can't audit whether a correction was right or whether the user accidentally overwrote a correct value. If I were the PM, I'd promote the original from a `<details>` block to a visible diff column so users instinctively compare before confirming. The spec treats correction as a write; I'd frame it as a reconciliation flow.

---

## Project structure

```
receipt-parser-assignment/
├── backend/src/
│   ├── index.ts                         # Express + global error middleware
│   ├── routes/
│   │   ├── parse.ts                     # POST /api/parse (image → structured data)
│   │   └── receipts.ts                  # GET/POST /api/receipts (Zod-validated PATCH)
│   └── services/
│       ├── prompts.ts                   # SYSTEM_PROMPT (isolated)
│       ├── llmShared.ts                 # Schema, parseJSON, createMultiParser factory
│       ├── openrouter.ts                # OpenRouter HTTP shape (gateways to OpenAI, Anthropic, Google, etc.)
│       ├── db.ts                        # JSON file persistence
│       └── __tests__/llmShared.test.ts  # 18 vitest cases
└── frontend/src/
    ├── pages/
    │   ├── Upload.tsx                   # Drag-drop upload
    │   ├── Review.tsx                   # Correction UX (the important page)
    │   └── History.tsx                  # Saved receipts only
    └── components/EditableField.tsx     # Click-to-edit primitive
```
