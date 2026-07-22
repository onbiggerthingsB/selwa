import { createHmac } from 'node:crypto';
import { Ratelimit, type Duration } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

export type PaidRoute = 'extract' | 'translate-notes' | 'advice';
export type DynamicRateLimitTarget =
  | 'extract-burst'
  | 'translate-notes-burst'
  | 'advice-burst'
  | 'daily-units';

export interface RateLimitConfig {
  redisUrl: string;
  redisToken: string;
  ipHashSecret: string;
  namespace: string;
  burstWindowSeconds: number;
  dailyWindowSeconds: number;
  extractBurst: number;
  translateNotesBurst: number;
  adviceBurst: number;
  dailyUnits: number;
  extractCostUnits: number;
  translateNotesCostUnits: number;
  adviceCostUnits: number;
  storeTimeoutMs: number;
}

export interface SharedWindowLimiter {
  limit(
    identifier: string,
    options?: { rate?: number },
  ): Promise<{
    success: boolean;
    reset: number;
    reason?: 'timeout' | 'cacheBlock' | 'denyList';
  }>;
  setDynamicLimit(options: { limit: number | false }): Promise<void>;
}

export interface PaidRouteLimiters {
  extractBurst: SharedWindowLimiter;
  translateNotesBurst: SharedWindowLimiter;
  adviceBurst: SharedWindowLimiter;
  dailyCost: SharedWindowLimiter;
}

export type PaidRouteLimitDecision =
  | { allowed: true }
  | { allowed: false; resetAt: number; window: 'burst' | 'daily' };

type Env = Record<string, string | undefined>;

export class RateLimitConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RateLimitConfigurationError';
  }
}

export class RateLimitStoreUnavailableError extends Error {
  constructor() {
    super('The shared rate-limit store is unavailable');
    this.name = 'RateLimitStoreUnavailableError';
  }
}

const DEFAULTS = {
  burstWindowSeconds: 60,
  dailyWindowSeconds: 86_400,
  extractBurst: 3,
  translateNotesBurst: 10,
  adviceBurst: 5, // FLAGGED DEFAULT: tune from production traffic before public launch.
  dailyUnits: 60,
  extractCostUnits: 5,
  translateNotesCostUnits: 1,
  adviceCostUnits: 3, // FLAGGED DEFAULT: three-school Opus generation; ~20/day at 60 units.
  storeTimeoutMs: 1_500,
} as const;

export const RATE_LIMITED_MESSAGE = {
  en: 'Too many report-reading requests have been made from this network. Please wait and try again later.',
  zh: '当前网络的报告读取请求次数过多。请稍后重试。',
} as const;

export const RATE_LIMIT_UNAVAILABLE_MESSAGE = {
  en: 'The report-reading service is temporarily unavailable. Please try again later.',
  zh: '报告读取服务暂时不可用。请稍后重试。',
} as const;

function required(env: Env, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new RateLimitConfigurationError(`${name} is not set`);
  return value;
}

/**
 * Read the first env var that is actually set, from a list of accepted names.
 *
 * WHY A LIST. The Upstash SDK's own convention is UPSTASH_REDIS_REST_URL /
 * UPSTASH_REDIS_REST_TOKEN, which is what you set by hand for local development. But
 * Vercel's Upstash Marketplace integration injects its own KV_* names and cannot be made
 * to emit the Upstash ones: its "custom prefix" option PREPENDS to fixed suffixes, so
 * asking for prefix `UPSTASH_REDIS_REST` yields UPSTASH_REDIS_REST_KV_REST_API_URL, not
 * UPSTASH_REDIS_REST_URL. There is no prefix that produces the SDK's names.
 *
 * Hard-coding either convention breaks the other environment, and the failure is
 * invisible: the limiter fails closed, so paid routes return 503 and it looks
 * exactly like an outage or a network block rather than a misnamed variable.
 *
 * So accept both, and — deliberately — do NOT accept a prefixed variant. If a prefix was
 * used at connect time, reconnect without one; encoding one team's accidental prefix here
 * would make the config silently environment-specific.
 */
function requiredOneOf(env: Env, names: readonly string[]): string {
  for (const name of names) {
    const value = env[name]?.trim();
    if (value) return value;
  }
  throw new RateLimitConfigurationError(
    `none of ${names.join(', ')} is set — set one (Vercel's Upstash integration provides the KV_REST_API_* names when connected with NO custom prefix)`,
  );
}

// Order matters only for determinism; either name is equally valid.
const REDIS_URL_ENV = ['UPSTASH_REDIS_REST_URL', 'KV_REST_API_URL'] as const;
const REDIS_TOKEN_ENV = ['UPSTASH_REDIS_REST_TOKEN', 'KV_REST_API_TOKEN'] as const;

function positiveInteger(env: Env, name: string, fallback: number): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RateLimitConfigurationError(`${name} must be a positive integer`);
  }
  return value;
}

function safeNamespace(raw: string | undefined): string {
  const normalized = (raw ?? 'development')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'development';
}

export function readRateLimitConfig(env: Env = process.env): RateLimitConfig {
  const ipHashSecret = required(env, 'RATE_LIMIT_IP_HASH_SECRET');
  if (ipHashSecret.length < 32) {
    throw new RateLimitConfigurationError(
      'RATE_LIMIT_IP_HASH_SECRET must be at least 32 characters',
    );
  }

  return {
    redisUrl: requiredOneOf(env, REDIS_URL_ENV),
    redisToken: requiredOneOf(env, REDIS_TOKEN_ENV),
    ipHashSecret,
    namespace: safeNamespace(
      env.RATE_LIMIT_NAMESPACE ?? env.VERCEL_ENV ?? env.NODE_ENV,
    ),
    burstWindowSeconds: positiveInteger(
      env,
      'RATE_LIMIT_BURST_WINDOW_SECONDS',
      DEFAULTS.burstWindowSeconds,
    ),
    dailyWindowSeconds: positiveInteger(
      env,
      'RATE_LIMIT_DAILY_WINDOW_SECONDS',
      DEFAULTS.dailyWindowSeconds,
    ),
    extractBurst: positiveInteger(
      env,
      'RATE_LIMIT_EXTRACT_BURST',
      DEFAULTS.extractBurst,
    ),
    translateNotesBurst: positiveInteger(
      env,
      'RATE_LIMIT_TRANSLATE_NOTES_BURST',
      DEFAULTS.translateNotesBurst,
    ),
    adviceBurst: positiveInteger(
      env,
      'RATE_LIMIT_ADVICE_BURST',
      DEFAULTS.adviceBurst,
    ),
    dailyUnits: positiveInteger(
      env,
      'RATE_LIMIT_DAILY_UNITS',
      DEFAULTS.dailyUnits,
    ),
    extractCostUnits: positiveInteger(
      env,
      'RATE_LIMIT_EXTRACT_COST_UNITS',
      DEFAULTS.extractCostUnits,
    ),
    translateNotesCostUnits: positiveInteger(
      env,
      'RATE_LIMIT_TRANSLATE_NOTES_COST_UNITS',
      DEFAULTS.translateNotesCostUnits,
    ),
    adviceCostUnits: positiveInteger(
      env,
      'RATE_LIMIT_ADVICE_COST_UNITS',
      DEFAULTS.adviceCostUnits,
    ),
    storeTimeoutMs: positiveInteger(
      env,
      'RATE_LIMIT_STORE_TIMEOUT_MS',
      DEFAULTS.storeTimeoutMs,
    ),
  };
}

function duration(seconds: number): Duration {
  return `${seconds} s`;
}

function createProductionLimiters(
  config: RateLimitConfig,
): PaidRouteLimiters {
  const redis = new Redis({
    url: config.redisUrl,
    token: config.redisToken,
  });
  const prefix = `health-translator:${config.namespace}:paid-api:v1`;
  const common = {
    redis,
    analytics: false,
    // This intentionally performs every decision against shared Redis. A module-
    // local cache is not protection across Vercel instances or cold starts.
    ephemeralCache: false as const,
    timeout: config.storeTimeoutMs,
    // Environment values are the deployed defaults. Dynamic overrides support
    // emergency tightening through the operator script without a redeploy.
    dynamicLimits: true,
  };

  return {
    extractBurst: new Ratelimit({
      ...common,
      prefix: `${prefix}:extract:burst`,
      limiter: Ratelimit.slidingWindow(
        config.extractBurst,
        duration(config.burstWindowSeconds),
      ),
    }),
    translateNotesBurst: new Ratelimit({
      ...common,
      prefix: `${prefix}:translate-notes:burst`,
      limiter: Ratelimit.slidingWindow(
        config.translateNotesBurst,
        duration(config.burstWindowSeconds),
      ),
    }),
    adviceBurst: new Ratelimit({
      ...common,
      prefix: `${prefix}:advice:burst`,
      limiter: Ratelimit.slidingWindow(
        config.adviceBurst,
        duration(config.burstWindowSeconds),
      ),
    }),
    dailyCost: new Ratelimit({
      ...common,
      prefix: `${prefix}:daily-cost`,
      limiter: Ratelimit.fixedWindow(
        config.dailyUnits,
        duration(config.dailyWindowSeconds),
      ),
    }),
  };
}

let productionState:
  | { config: RateLimitConfig; limiters: PaidRouteLimiters }
  | undefined;

function getProductionState(): {
  config: RateLimitConfig;
  limiters: PaidRouteLimiters;
} {
  if (!productionState) {
    const config = readRateLimitConfig();
    productionState = {
      config,
      limiters: createProductionLimiters(config),
    };
  }
  return productionState;
}

/**
 * Vercel overwrites x-vercel-forwarded-for/x-forwarded-for at its trusted edge.
 * Outside that boundary these headers are spoofable, and NAT can make unrelated
 * people share one IP. This raises the cost of abuse; it is not authentication.
 */
export function requestIp(headers: Pick<Headers, 'get'>): string {
  for (const name of [
    'x-vercel-forwarded-for',
    'x-forwarded-for',
    'x-real-ip',
  ]) {
    const first = headers.get(name)?.split(',')[0]?.trim();
    if (first) return first.slice(0, 128);
  }
  // Never bypass the limiter when no address is available. Headerless requests
  // share one conservative bucket.
  return 'unknown';
}

export function hashRateLimitIdentifier(ip: string, secret: string): string {
  return `v1:${createHmac('sha256', secret).update(ip).digest('hex')}`;
}

function assertStoreResult(result: {
  reason?: 'timeout' | 'cacheBlock' | 'denyList';
}): void {
  // @upstash/ratelimit's timeout response is success=true (fail-open) by
  // default. Paid model routes must fail closed instead.
  if (result.reason === 'timeout') throw new RateLimitStoreUnavailableError();
}

const BURST_LIMITER_BY_ROUTE = {
  extract: 'extractBurst',
  'translate-notes': 'translateNotesBurst',
  advice: 'adviceBurst',
} as const satisfies Record<
  PaidRoute,
  keyof Pick<
    PaidRouteLimiters,
    'extractBurst' | 'translateNotesBurst' | 'adviceBurst'
  >
>;

const COST_UNITS_BY_ROUTE = {
  extract: 'extractCostUnits',
  'translate-notes': 'translateNotesCostUnits',
  advice: 'adviceCostUnits',
} as const satisfies Record<
  PaidRoute,
  keyof Pick<
    RateLimitConfig,
    'extractCostUnits' | 'translateNotesCostUnits' | 'adviceCostUnits'
  >
>;

export async function applyPaidRouteLimits(input: {
  route: PaidRoute;
  identifier: string;
  limiters: PaidRouteLimiters;
  config: Pick<
    RateLimitConfig,
    'extractCostUnits' | 'translateNotesCostUnits' | 'adviceCostUnits'
  >;
}): Promise<PaidRouteLimitDecision> {
  const burst = input.limiters[BURST_LIMITER_BY_ROUTE[input.route]];
  const burstResult = await burst.limit(input.identifier);
  assertStoreResult(burstResult);
  if (!burstResult.success) {
    return {
      allowed: false,
      resetAt: burstResult.reset,
      window: 'burst',
    };
  }

  const rate = input.config[COST_UNITS_BY_ROUTE[input.route]];
  const dailyResult = await input.limiters.dailyCost.limit(input.identifier, {
    rate,
  });
  assertStoreResult(dailyResult);
  if (!dailyResult.success) {
    return {
      allowed: false,
      resetAt: dailyResult.reset,
      window: 'daily',
    };
  }

  return { allowed: true };
}

export async function checkPaidRouteRateLimit(
  request: Pick<Request, 'headers'>,
  route: PaidRoute,
): Promise<PaidRouteLimitDecision> {
  const { config, limiters } = getProductionState();
  const identifier = hashRateLimitIdentifier(
    requestIp(request.headers),
    config.ipHashSecret,
  );
  return applyPaidRouteLimits({ route, identifier, limiters, config });
}

export function rateLimitedResponse(
  decision: Extract<PaidRouteLimitDecision, { allowed: false }>,
  now: number = Date.now(),
): Response {
  const headers: Record<string, string> = {
    'Cache-Control': 'no-store',
  };
  // Upstash documents sliding-window `reset` as a boundary marker, not an
  // exact time when another request will pass. Only the fixed daily window
  // can support an honest Retry-After value.
  if (decision.window === 'daily') {
    headers['Retry-After'] = String(
      Math.max(1, Math.ceil((decision.resetAt - now) / 1_000)),
    );
  }

  return Response.json(
    {
      error: RATE_LIMITED_MESSAGE.en,
      errorZh: RATE_LIMITED_MESSAGE.zh,
    },
    {
      status: 429,
      headers,
    },
  );
}

function rateLimitUnavailableResponse(): Response {
  return Response.json(
    {
      error: RATE_LIMIT_UNAVAILABLE_MESSAGE.en,
      errorZh: RATE_LIMIT_UNAVAILABLE_MESSAGE.zh,
    },
    {
      status: 503,
      headers: { 'Cache-Control': 'no-store' },
    },
  );
}

export async function enforcePaidRouteRateLimit(
  request: Pick<Request, 'headers'>,
  route: PaidRoute,
): Promise<Response | null> {
  try {
    const decision = await checkPaidRouteRateLimit(request, route);
    return decision.allowed ? null : rateLimitedResponse(decision);
  } catch (error) {
    // Never log the error object, raw IP, hash, headers, or payload. Redis/SDK
    // errors can contain endpoint or credential details.
    console.error('paid route rate limit unavailable', {
      route,
      cause:
        error instanceof RateLimitConfigurationError
          ? 'configuration'
          : 'store-unavailable',
    });
    return rateLimitUnavailableResponse();
  }
}

export async function setDynamicRateLimitOverride(
  target: DynamicRateLimitTarget,
  limit: number | false,
): Promise<void> {
  if (
    limit !== false &&
    (!Number.isSafeInteger(limit) || limit <= 0)
  ) {
    throw new RateLimitConfigurationError(
      'Dynamic rate limit must be a positive integer or false',
    );
  }

  const { limiters } = getProductionState();
  const limiterByTarget = {
    'extract-burst': limiters.extractBurst,
    'translate-notes-burst': limiters.translateNotesBurst,
    'advice-burst': limiters.adviceBurst,
    'daily-units': limiters.dailyCost,
  } satisfies Record<DynamicRateLimitTarget, SharedWindowLimiter>;
  const limiter = limiterByTarget[target];
  await limiter.setDynamicLimit({ limit });
}
