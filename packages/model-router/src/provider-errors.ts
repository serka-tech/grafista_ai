/**
 * Grafista AI Studio — Provider Error Classification + Classified Retry (Phase 3 Step 3)
 *
 * Replaces the router's previous BLIND retry loop (every failure — including a
 * 401 with a bad API key — was retried 3 times back-to-back with no backoff).
 * Two exports matter to callers:
 *
 *   - classifyProviderError(): maps a failed AIResponse (error message +
 *     optional structural httpStatus) to a ProviderErrorKind and whether that
 *     kind is worth retrying at the transport layer.
 *   - executeWithClassifiedRetry(): the retry loop ModelRouter.complete() now
 *     uses — retries ONLY retryable kinds, with per-kind attempt limits and
 *     exponential backoff. The delay function is injectable so tests never
 *     actually sleep.
 *
 * Schema-validation failures are deliberately NOT retried here: they happen in
 * the API service layer AFTER a successful transport response, and get their
 * own limited retry in apps/api/src/services/ai-call-helper.ts.
 *
 * Nothing in this module ever logs request payloads, prompts, or secrets —
 * only provider names, attempt counts, classifications, and provider error
 * messages that the adapters already produce.
 */

import { AIResponse, ProviderErrorKind } from './types.js';

export interface ProviderErrorClassification {
  kind: ProviderErrorKind;
  /** Whether the transport layer should retry this kind at all. */
  retryable: boolean;
  /** The HTTP status used for classification (explicit or extracted from the message), if any. */
  httpStatus?: number;
}

export interface RetryPolicy {
  /** Extra attempts AFTER the first one (0 = fail fast). */
  maxRetries: number;
  /** First backoff delay; doubles on each subsequent retry (exponential). */
  baseDelayMs: number;
}

/**
 * Per-kind retry policy. Non-retryable kinds are all zeroed; retryable kinds
 * stay conservative (the old blind loop's 3 total attempts is the ceiling).
 */
export const DEFAULT_RETRY_POLICIES: Readonly<Record<ProviderErrorKind, RetryPolicy>> = {
  transient: { maxRetries: 2, baseDelayMs: 250 },
  rate_limit: { maxRetries: 2, baseDelayMs: 1000 },
  timeout: { maxRetries: 1, baseDelayMs: 500 },
  // Unclassifiable errors keep ONE retry so genuinely flaky-but-unrecognized
  // failures retain a fraction of the old blind loop's resilience.
  unknown: { maxRetries: 1, baseDelayMs: 250 },
  schema_validation: { maxRetries: 0, baseDelayMs: 0 }, // handled in the service layer, not here
  permanent: { maxRetries: 0, baseDelayMs: 0 },
  auth_error: { maxRetries: 0, baseDelayMs: 0 },
  provider_unavailable: { maxRetries: 0, baseDelayMs: 0 },
};

const RETRYABLE_KINDS: ReadonlySet<ProviderErrorKind> = new Set(['transient', 'rate_limit', 'timeout', 'unknown']);

/** Missing env/config and no-provider situations — retrying can never help. */
const PROVIDER_UNAVAILABLE_PATTERNS =
  /provider configuration error|is not set|no provider available|not active in phase/i;
/** Timeouts and aborted requests (AbortController fires "operation was aborted"). */
const TIMEOUT_PATTERNS = /timed?[ -]?out|timeout|operation was aborted|aborterror|deadline exceeded/i;
/** Rate limiting expressed in prose rather than a structural 429. */
const RATE_LIMIT_PATTERNS = /rate limit|too many requests|quota exceeded/i;
/** Node/undici network-level failures — connection level, worth retrying. */
const NETWORK_PATTERNS =
  /econnreset|econnrefused|etimedout|enotfound|eai_again|epipe|socket hang up|network error|fetch failed|terminated|other side closed/i;
const SCHEMA_PATTERNS = /schema validation/i;

/**
 * Best-effort HTTP status extraction from adapter error strings that embed it
 * (e.g. Kie AI's `fetchJson` produces "Kie AI HTTP 502: ..."; OpenAI SDK
 * messages often start with "429 ..."). Structural `httpStatus` always wins.
 */
function extractHttpStatus(message: string): number | undefined {
  const embedded = message.match(/\bHTTP (\d{3})\b/i) ?? message.match(/^(\d{3})\s/);
  if (!embedded) return undefined;
  const status = Number(embedded[1]);
  return status >= 100 && status <= 599 ? status : undefined;
}

/**
 * Classifies a failed provider response. Rules (first match wins):
 *   - missing provider config / no provider  -> provider_unavailable (no retry)
 *   - HTTP 429                               -> rate_limit          (retry, backoff)
 *   - HTTP 408                               -> timeout             (retry)
 *   - HTTP 401/403                           -> auth_error          (NO retry)
 *   - HTTP 5xx (500/502/503/504/...)         -> transient           (retry)
 *   - other HTTP 4xx (400/404/422/...)       -> permanent           (NO retry)
 *   - timeout / abort message                -> timeout             (retry)
 *   - rate-limit message                     -> rate_limit          (retry)
 *   - network-level message                  -> transient           (retry)
 *   - "schema validation" message            -> schema_validation   (no transport retry)
 *   - anything else                          -> unknown             (1 conservative retry)
 */
export function classifyProviderError(input: { error?: string; httpStatus?: number }): ProviderErrorClassification {
  const message = input.error ?? '';
  const httpStatus = input.httpStatus ?? extractHttpStatus(message);

  let kind: ProviderErrorKind;
  if (PROVIDER_UNAVAILABLE_PATTERNS.test(message)) {
    kind = 'provider_unavailable';
  } else if (httpStatus !== undefined) {
    if (httpStatus === 429) kind = 'rate_limit';
    else if (httpStatus === 408) kind = 'timeout';
    else if (httpStatus === 401 || httpStatus === 403) kind = 'auth_error';
    else if (httpStatus >= 500) kind = 'transient';
    else if (httpStatus >= 400) kind = 'permanent';
    else kind = 'unknown';
  } else if (TIMEOUT_PATTERNS.test(message)) {
    kind = 'timeout';
  } else if (RATE_LIMIT_PATTERNS.test(message)) {
    kind = 'rate_limit';
  } else if (NETWORK_PATTERNS.test(message)) {
    kind = 'transient';
  } else if (SCHEMA_PATTERNS.test(message)) {
    kind = 'schema_validation';
  } else {
    kind = 'unknown';
  }

  return { kind, retryable: RETRYABLE_KINDS.has(kind), httpStatus };
}

/**
 * Backoff delay before retry number `retryIndex` (0-based): exponential
 * doubling from the policy's base. AI_RETRY_BASE_DELAY_MS (when set to a
 * non-negative integer) overrides every kind's base — setting it to 0 disables
 * waiting entirely (useful in tests/CI without touching code).
 */
export function retryDelayMs(kind: ProviderErrorKind, retryIndex: number, policy?: RetryPolicy): number {
  const resolved = policy ?? DEFAULT_RETRY_POLICIES[kind];
  const envRaw = process.env.AI_RETRY_BASE_DELAY_MS;
  const envBase = envRaw !== undefined && envRaw !== '' ? Number(envRaw) : NaN;
  const base = Number.isFinite(envBase) && envBase >= 0 ? envBase : resolved.baseDelayMs;
  return base * 2 ** retryIndex;
}

export type DelayFn = (ms: number) => Promise<void>;

function defaultSleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface ClassifiedRetryOptions {
  /** Builds a structured failure AIResponse when the attempt function THROWS (adapters normally never throw). */
  buildFailure: (error: string) => AIResponse;
  /** Per-kind policy overrides (partial; unspecified kinds keep the defaults). */
  policies?: Partial<Record<ProviderErrorKind, RetryPolicy>>;
  /** Injectable delay — tests pass an instant resolver so no real waiting happens. */
  delayFn?: DelayFn;
  /** Observability hook per failed attempt (used by the router for a secret-free warn log). */
  onAttemptFailure?: (info: {
    attempt: number;
    kind: ProviderErrorKind;
    retryable: boolean;
    willRetry: boolean;
    delayMs: number;
    error: string;
  }) => void;
}

/**
 * Runs `attemptFn` with the classified retry policy. Returns the first
 * successful AIResponse, or the LAST failure annotated with `errorKind`,
 * `httpStatus` (when known) and `attempts`. Multi-attempt failures keep the
 * pre-existing "All N attempts failed: ..." message shape; fail-fast failures
 * return the adapter's original error message untouched.
 */
export async function executeWithClassifiedRetry(
  attemptFn: () => Promise<AIResponse>,
  options: ClassifiedRetryOptions
): Promise<AIResponse> {
  const delayFn = options.delayFn ?? defaultSleep;
  let attempt = 0;

  for (;;) {
    attempt += 1;

    let response: AIResponse;
    try {
      response = await attemptFn();
    } catch (err) {
      response = options.buildFailure(err instanceof Error ? err.message : String(err));
    }

    if (response.success) {
      return attempt > 1 ? { ...response, attempts: attempt } : response;
    }

    const errorMessage = response.error ?? 'Unknown provider error';
    const classification = classifyProviderError({ error: errorMessage, httpStatus: response.httpStatus });
    const policy = options.policies?.[classification.kind] ?? DEFAULT_RETRY_POLICIES[classification.kind];
    const retriesUsed = attempt - 1;
    const willRetry = classification.retryable && retriesUsed < policy.maxRetries;
    const delayMs = willRetry ? retryDelayMs(classification.kind, retriesUsed, policy) : 0;

    options.onAttemptFailure?.({
      attempt,
      kind: classification.kind,
      retryable: classification.retryable,
      willRetry,
      delayMs,
      error: errorMessage,
    });

    if (!willRetry) {
      return {
        ...response,
        error: attempt > 1 ? `All ${attempt} attempts failed: ${errorMessage}` : errorMessage,
        errorKind: classification.kind,
        httpStatus: response.httpStatus ?? classification.httpStatus,
        attempts: attempt,
      };
    }

    await delayFn(delayMs);
  }
}
