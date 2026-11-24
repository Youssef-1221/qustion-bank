import { GenerateContentResponse, GoogleGenAI, ThinkingLevel } from "@google/genai";

export class QuotaExhaustedError extends Error {
  public readonly retryAfterText?: string;
  constructor(message: string, retryAfterText?: string) {
    super(message);
    this.name = "QuotaExhaustedError";
    this.retryAfterText = retryAfterText;
  }
}

export function isDailyQuotaError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err || "");
  return (
    /RESOURCE_EXHAUSTED/i.test(msg) ||
    /GenerateRequestsPerDay/i.test(msg) ||
    /free_tier_requests/i.test(msg) ||
    /exceeded your current quota/i.test(msg) ||
    /"code":\s*429/i.test(msg)
  );
}

export function isTransientOverloadError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err || "");
  return (
    /"code":\s*503/i.test(msg) ||
    /\b503\b/.test(msg) ||
    /UNAVAILABLE/i.test(msg) ||
    /high demand/i.test(msg) ||
    /overloaded/i.test(msg) ||
    /"code":\s*500/i.test(msg) ||
    /DEADLINE_EXCEEDED/i.test(msg) ||
    /ETIMEDOUT|ECONNRESET|fetch failed/i.test(msg)
  );
}

export function formatFriendlyAiError(err: unknown): string {
  if (err instanceof QuotaExhaustedError) {
    return err.message;
  }
  const raw = err instanceof Error ? err.message : String(err || "AI request failed.");

  if (isDailyQuotaError(err)) {
    const retryMatch = raw.match(/Please retry in\s+([^\s."\\]+)/i);
    const retryHint = retryMatch?.[1]
      ? ` (resets in ~${retryMatch[1].replace(/\.\d+s$/, "s")})`
      : "";
    return `Gemini API Free Tier daily request quota reached (20 requests/day limit)${retryHint}. Note: this limit counts the number of AI API calls, not file MB size. Please add a billing-enabled API key in Settings > Secrets, or wait for the daily quota reset.`;
  }

  if (isTransientOverloadError(err)) {
    return "Gemini AI service is temporarily experiencing high demand (503 Unavailable). Please wait 15–30 seconds and try again.";
  }

  return raw.slice(0, 500);
}

export async function generateWithModelFallback(
  ai: GoogleGenAI,
  params: {
    primaryModel?: string;
    fallbackModel?: string;
    contents: unknown;
    systemInstruction?: string;
    thinkingLevel?: ThinkingLevel;
    responseMimeType?: string;
    responseSchema?: unknown;
  }
): Promise<GenerateContentResponse> {
  const primaryModel = params.primaryModel || "gemini-4-hydrogen";
  const fallbackModel = params.fallbackModel || "gemini-3.1-flash-lite";

  const callModel = async (
    model: string,
    thinkingLevel?: ThinkingLevel
  ): Promise<GenerateContentResponse> => {
    const config: Record<string, unknown> = {};
    if (params.systemInstruction) config.systemInstruction = params.systemInstruction;
    if (params.responseMimeType) config.responseMimeType = params.responseMimeType;
    if (params.responseSchema) config.responseSchema = params.responseSchema;
    if (thinkingLevel) {
      config.thinkingConfig = {
        thinkingLevel:
          model === "gemini-3.1-flash-lite" && thinkingLevel === ThinkingLevel.HIGH
            ? ThinkingLevel.MEDIUM
            : thinkingLevel,
      };
    }

    return ai.models.generateContent({
      model,
      contents: params.contents as never,
      config: config as never,
    });
  };

  let lastErr: unknown;

  // Try primary model with backoff on transient 503/500 errors, stop immediately on 429 daily quota
  for (let attempt = 0; attempt <= 2; attempt++) {
    try {
      return await callModel(primaryModel, params.thinkingLevel);
    } catch (err) {
      lastErr = err;
      if (isDailyQuotaError(err)) {
        break;
      }
      if (isTransientOverloadError(err) && attempt < 2) {
        const delayMs = 1800 * Math.pow(2, attempt) + Math.floor(Math.random() * 500);
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }
      break;
    }
  }

  // Fallback to secondary free-tier model if primary hit daily quota OR 503 high demand
  const shouldFallback =
    (isDailyQuotaError(lastErr) || isTransientOverloadError(lastErr)) &&
    fallbackModel &&
    fallbackModel !== primaryModel;

  if (shouldFallback) {
    for (let fbAttempt = 0; fbAttempt <= 1; fbAttempt++) {
      try {
        return await callModel(
          fallbackModel,
          params.thinkingLevel === ThinkingLevel.HIGH
            ? ThinkingLevel.MEDIUM
            : params.thinkingLevel || ThinkingLevel.LOW
        );
      } catch (fallbackErr) {
        if (isDailyQuotaError(fallbackErr)) {
          throw new QuotaExhaustedError(formatFriendlyAiError(fallbackErr));
        }
        if (isTransientOverloadError(fallbackErr) && fbAttempt < 1) {
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }
        if (isDailyQuotaError(lastErr)) {
          throw new QuotaExhaustedError(formatFriendlyAiError(lastErr));
        }
        throw new Error(formatFriendlyAiError(fallbackErr));
      }
    }
  }

  if (isDailyQuotaError(lastErr)) {
    throw new QuotaExhaustedError(formatFriendlyAiError(lastErr));
  }

  throw new Error(formatFriendlyAiError(lastErr));
}
