import { createMultiParser, type CallLLM } from "./llmShared";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

const DEFAULT_TIMEOUT_MS = 15000;

export function makeOpenRouterCaller(model: string): CallLLM {
  return async (imageBase64, mediaType, systemPrompt) => {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new Error("OPENROUTER_API_KEY is not set");
    }
    const timeoutMs = Number(process.env.OPENROUTER_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    };
    if (process.env.OPENROUTER_REFERER) {
      headers["HTTP-Referer"] = process.env.OPENROUTER_REFERER;
    }
    if (process.env.OPENROUTER_TITLE) {
      headers["X-Title"] = process.env.OPENROUTER_TITLE;
    }

    let res: Response;
    try {
      res = await fetch(OPENROUTER_URL, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model,
          max_tokens: 1024,
          messages: [
            { role: "system", content: systemPrompt },
            {
              role: "user",
              content: [
                {
                  type: "image_url",
                  image_url: { url: `data:${mediaType};base64,${imageBase64}` },
                },
                { type: "text", text: "Parse this receipt and return the JSON." },
              ],
            },
          ],
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      if (err instanceof Error && err.name === "TimeoutError") {
        throw new Error(`OpenRouter[${model}] timed out after ${timeoutMs}ms`);
      }
      throw err;
    }

    if (!res.ok) {
      throw new Error(`OpenRouter[${model}] ${res.status}: ${await res.text()}`);
    }

    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    return json.choices?.[0]?.message?.content?.trim() ?? "";
  };
}

export const parseReceiptImage = (imageBase64: string, mimeType: string) => {
  const primary = process.env.OPENROUTER_MODEL ?? "openai/gpt-4o-mini";
  const fallbacks = (process.env.OPENROUTER_FALLBACK_MODELS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const callers = [primary, ...fallbacks].map(makeOpenRouterCaller);
  return createMultiParser(callers)(imageBase64, mimeType);
};
