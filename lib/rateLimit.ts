import { createHmac } from 'node:crypto';
import { Ratelimit, type Duration } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

export type PaidRoute = 'extract' | 'translate-notes';
export type DynamicRateLimitTarget =
  | 'extract-burst'
  | 'translate-notes-burst'
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
  dailyUnits: number;
  extractCostUnits: number;
  translateNotesCostUnits: number;
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
  dailyUnits: 60,
  extractCostUnits: 5,
  translateNotesCostUnits: 1,
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
    redisUrl: required(env, 'UPSTASH_REDIS_REST_URL'),
    redisToken: required(env, 'UPSTASH_REDIS_REST_TOKEN'),
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

export async function applyPaidRouteLimits(input: {
  route: PaidRoute;
  identifier: string;
  limiters: PaidRouteLimiters;
  config: Pick<
    RateLimitConfig,
    'extractCostUnits' | 'translateNotesCostUnits'
  >;
}): Promise<PaidRouteLimitDecision> {
  const burst =
    input.route === 'extract'
      ? input.limiters.extractBurst
      : input.limiters.translateNotesBurst;
  const burstResult = await burst.limit(input.identifier);
  assertStoreResult(burstResult);
  if (!burstResult.success) {
    return {
      allowed: false,
      resetAt: burstResult.reset,
      window: 'burst',
    };
  }

  const rate =
    input.route === 'extract'
      ? input.config.extractCostUnits
      : input.config.translateNotesCostUnits;
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
  const limiter =
    target === 'extract-burst'
      ? limiters.extractBurst
      : target === 'translate-notes-burst'
        ? limiters.translateNotesBurst
        : limiters.dailyCost;
  await limiter.setDynamicLimit({ limit });
}
