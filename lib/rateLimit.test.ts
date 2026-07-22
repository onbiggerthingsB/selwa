import { describe, expect, it, vi } from 'vitest';
import {
  RATE_LIMITED_MESSAGE,
  RateLimitConfigurationError,
  RateLimitStoreUnavailableError,
  applyPaidRouteLimits,
  hashRateLimitIdentifier,
  rateLimitedResponse,
  readRateLimitConfig,
  requestIp,
  setDynamicRateLimitOverride,
  type PaidRouteLimiters,
  type SharedWindowLimiter,
} from './rateLimit';

const REQUIRED_ENV = {
  UPSTASH_REDIS_REST_URL: 'https://example.upstash.io',
  UPSTASH_REDIS_REST_TOKEN: 'test-token-that-never-leaves-this-test',
  RATE_LIMIT_IP_HASH_SECRET: '0123456789abcdef0123456789abcdef',
} as const;

const COSTS = {
  extractCostUnits: 5,
  translateNotesCostUnits: 1,
  adviceCostUnits: 3,
} as const;

/**
 * Test-only shared-window stand-in. Production decisions are backed by Redis;
 * this deterministic fake exists solely to exercise orchestration and resets.
 */
class FakeWindowLimiter implements SharedWindowLimiter {
  readonly calls: Array<{ identifier: string; rate: number }> = [];
  readonly setDynamicLimit = vi.fn(async (_options: { limit: number | false }) => {});

  private readonly buckets = new Map<
    string,
    { windowStart: number; used: number }
  >();
  private readonly rollingHits = new Map<
    string,
    Array<{ at: number; rate: number }>
  >();

  constructor(
    private readonly maximum: number,
    private readonly windowMs: number,
    private readonly now: () => number,
    private readonly mode: 'fixed' | 'sliding',
  ) {}

  async limit(
    identifier: string,
    options: { rate?: number } = {},
  ): Promise<{ success: boolean; reset: number }> {
    const rate = options.rate ?? 1;
    const now = this.now();
    this.calls.push({ identifier, rate });

    if (this.mode === 'sliding') {
      const hits = (this.rollingHits.get(identifier) ?? []).filter(
        ({ at }) => at > now - this.windowMs,
      );
      hits.push({ at: now, rate });
      this.rollingHits.set(identifier, hits);
      return {
        success:
          hits.reduce((used, hit) => used + hit.rate, 0) <= this.maximum,
        reset: hits[0].at + this.windowMs,
      };
    }

    const windowStart = Math.floor(now / this.windowMs) * this.windowMs;
    const prior = this.buckets.get(identifier);
    const bucket =
      prior?.windowStart === windowStart
        ? prior
        : { windowStart, used: 0 };

    bucket.used += rate;
    this.buckets.set(identifier, bucket);

    return {
      success: bucket.used <= this.maximum,
      reset: windowStart + this.windowMs,
    };
  }
}

function fakeLimiters(input: {
  now: () => number;
  extractBurst?: number;
  translateNotesBurst?: number;
  adviceBurst?: number;
  dailyUnits?: number;
  burstWindowMs?: number;
  dailyWindowMs?: number;
}): PaidRouteLimiters & {
  extractBurst: FakeWindowLimiter;
  translateNotesBurst: FakeWindowLimiter;
  adviceBurst: FakeWindowLimiter;
  dailyCost: FakeWindowLimiter;
} {
  return {
    extractBurst: new FakeWindowLimiter(
      input.extractBurst ?? 100,
      input.burstWindowMs ?? 60_000,
      input.now,
      'sliding',
    ),
    translateNotesBurst: new FakeWindowLimiter(
      input.translateNotesBurst ?? 100,
      input.burstWindowMs ?? 60_000,
      input.now,
      'sliding',
    ),
    adviceBurst: new FakeWindowLimiter(
      input.adviceBurst ?? 100,
      input.burstWindowMs ?? 60_000,
      input.now,
      'sliding',
    ),
    dailyCost: new FakeWindowLimiter(
      input.dailyUnits ?? 1_000,
      input.dailyWindowMs ?? 86_400_000,
      input.now,
      'fixed',
    ),
  };
}

describe('readRateLimitConfig', () => {
  it('requires shared-store credentials and a private IP hash secret', () => {
    for (const name of [
      'UPSTASH_REDIS_REST_URL',
      'UPSTASH_REDIS_REST_TOKEN',
      'RATE_LIMIT_IP_HASH_SECRET',
    ] as const) {
      const env: Record<string, string | undefined> = { ...REQUIRED_ENV };
      delete env[name];

      // The IP-hash secret has exactly one accepted name, so its message is exact.
      // The Redis credentials accept either the Upstash SDK name or Vercel's
      // KV_REST_API_* name, so removing one still fails closed but names both.
      if (name === 'RATE_LIMIT_IP_HASH_SECRET') {
        expect(() => readRateLimitConfig(env)).toThrow(
          new RateLimitConfigurationError(`${name} is not set`),
        );
      } else {
        expect(() => readRateLimitConfig(env)).toThrow(RateLimitConfigurationError);
        expect(() => readRateLimitConfig(env)).toThrow(new RegExp(name));
      }
    }
  });

  it('rejects an IP hash secret shorter than 32 characters', () => {
    expect(() =>
      readRateLimitConfig({
        ...REQUIRED_ENV,
        RATE_LIMIT_IP_HASH_SECRET: 'too-short',
      }),
    ).toThrow('RATE_LIMIT_IP_HASH_SECRET must be at least 32 characters');
  });

  it('uses spend-shaped defaults and derives a safe deployment namespace', () => {
    expect(
      readRateLimitConfig({ ...REQUIRED_ENV, VERCEL_ENV: 'Preview / West' }),
    ).toEqual({
      redisUrl: REQUIRED_ENV.UPSTASH_REDIS_REST_URL,
      redisToken: REQUIRED_ENV.UPSTASH_REDIS_REST_TOKEN,
      ipHashSecret: REQUIRED_ENV.RATE_LIMIT_IP_HASH_SECRET,
      namespace: 'preview-west',
      burstWindowSeconds: 60,
      dailyWindowSeconds: 86_400,
      extractBurst: 3,
      translateNotesBurst: 10,
      adviceBurst: 5,
      dailyUnits: 60,
      extractCostUnits: 5,
      translateNotesCostUnits: 1,
      adviceCostUnits: 3,
      storeTimeoutMs: 1_500,
    });
  });

  it('accepts every documented limit override', () => {
    expect(
      readRateLimitConfig({
        ...REQUIRED_ENV,
        RATE_LIMIT_NAMESPACE: 'Production_Asia',
        RATE_LIMIT_BURST_WINDOW_SECONDS: '30',
        RATE_LIMIT_DAILY_WINDOW_SECONDS: '43200',
        RATE_LIMIT_EXTRACT_BURST: '2',
        RATE_LIMIT_TRANSLATE_NOTES_BURST: '8',
        RATE_LIMIT_ADVICE_BURST: '4',
        RATE_LIMIT_DAILY_UNITS: '40',
        RATE_LIMIT_EXTRACT_COST_UNITS: '7',
        RATE_LIMIT_TRANSLATE_NOTES_COST_UNITS: '2',
        RATE_LIMIT_ADVICE_COST_UNITS: '6',
        RATE_LIMIT_STORE_TIMEOUT_MS: '900',
      }),
    ).toMatchObject({
      namespace: 'production_asia',
      burstWindowSeconds: 30,
      dailyWindowSeconds: 43_200,
      extractBurst: 2,
      translateNotesBurst: 8,
      adviceBurst: 4,
      dailyUnits: 40,
      extractCostUnits: 7,
      translateNotesCostUnits: 2,
      adviceCostUnits: 6,
      storeTimeoutMs: 900,
    });
  });

  it.each([
    'RATE_LIMIT_BURST_WINDOW_SECONDS',
    'RATE_LIMIT_DAILY_WINDOW_SECONDS',
    'RATE_LIMIT_EXTRACT_BURST',
    'RATE_LIMIT_TRANSLATE_NOTES_BURST',
    'RATE_LIMIT_ADVICE_BURST',
    'RATE_LIMIT_DAILY_UNITS',
    'RATE_LIMIT_EXTRACT_COST_UNITS',
    'RATE_LIMIT_TRANSLATE_NOTES_COST_UNITS',
    'RATE_LIMIT_ADVICE_COST_UNITS',
    'RATE_LIMIT_STORE_TIMEOUT_MS',
  ])('rejects non-positive %s', (name) => {
    expect(() =>
      readRateLimitConfig({ ...REQUIRED_ENV, [name]: '0' }),
    ).toThrow(`${name} must be a positive integer`);
  });

  it.each(['-1', '1.5', 'not-a-number', '9007199254740992'])(
    'rejects an unsafe or non-integer numeric value (%s)',
    (value) => {
      expect(() =>
        readRateLimitConfig({
          ...REQUIRED_ENV,
          RATE_LIMIT_DAILY_UNITS: value,
        }),
      ).toThrow('RATE_LIMIT_DAILY_UNITS must be a positive integer');
    },
  );
});

describe('IP identifiers', () => {
  it('prefers Vercel forwarding, then the standard forwarding header, then real IP', () => {
    expect(
      requestIp(
        new Headers({
          'x-vercel-forwarded-for': '203.0.113.1, 10.0.0.2',
          'x-forwarded-for': '203.0.113.2',
          'x-real-ip': '203.0.113.3',
        }),
      ),
    ).toBe('203.0.113.1');

    expect(
      requestIp(
        new Headers({
          'x-forwarded-for': ' 203.0.113.4, 10.0.0.3 ',
          'x-real-ip': '203.0.113.5',
        }),
      ),
    ).toBe('203.0.113.4');
    expect(requestIp(new Headers({ 'x-real-ip': '203.0.113.6' }))).toBe(
      '203.0.113.6',
    );
  });

  it('places requests with no observed IP into one conservative unknown bucket', () => {
    expect(requestIp(new Headers())).toBe('unknown');
    expect(requestIp(new Headers({ 'x-forwarded-for': ' , ' }))).toBe(
      'unknown',
    );
  });

  it('HMACs identifiers deterministically without retaining the raw IP', () => {
    const ip = '203.0.113.77';
    const first = hashRateLimitIdentifier(
      ip,
      REQUIRED_ENV.RATE_LIMIT_IP_HASH_SECRET,
    );
    const second = hashRateLimitIdentifier(
      ip,
      REQUIRED_ENV.RATE_LIMIT_IP_HASH_SECRET,
    );

    expect(first).toBe(second);
    expect(first).toMatch(/^v1:[a-f0-9]{64}$/);
    expect(first).not.toContain(ip);
    expect(
      hashRateLimitIdentifier(ip, 'fedcba9876543210fedcba9876543210'),
    ).not.toBe(first);
    expect(
      hashRateLimitIdentifier(
        '203.0.113.78',
        REQUIRED_ENV.RATE_LIMIT_IP_HASH_SECRET,
      ),
    ).not.toBe(first);
  });
});

describe('applyPaidRouteLimits', () => {
  it('enforces independent burst limits for the existing paid routes', async () => {
    const now = 1_000;
    const limiters = fakeLimiters({
      now: () => now,
      extractBurst: 1,
      translateNotesBurst: 2,
    });
    const input = { identifier: 'same-ip', limiters, config: COSTS };

    await expect(
      applyPaidRouteLimits({ ...input, route: 'extract' }),
    ).resolves.toEqual({ allowed: true });
    await expect(
      applyPaidRouteLimits({ ...input, route: 'extract' }),
    ).resolves.toMatchObject({ allowed: false, window: 'burst' });

    await expect(
      applyPaidRouteLimits({ ...input, route: 'translate-notes' }),
    ).resolves.toEqual({ allowed: true });
    await expect(
      applyPaidRouteLimits({ ...input, route: 'translate-notes' }),
    ).resolves.toEqual({ allowed: true });
    await expect(
      applyPaidRouteLimits({ ...input, route: 'translate-notes' }),
    ).resolves.toMatchObject({ allowed: false, window: 'burst' });

    expect(limiters.extractBurst.calls).toHaveLength(2);
    expect(limiters.translateNotesBurst.calls).toHaveLength(3);
    expect(now).toBe(1_000);
  });

  it('routes advice to a burst bucket separate from both existing routes', async () => {
    const limiters = fakeLimiters({
      now: () => 1_500,
      extractBurst: 1,
      translateNotesBurst: 1,
      adviceBurst: 1,
    });
    const input = { identifier: 'same-ip', limiters, config: COSTS };

    await expect(
      applyPaidRouteLimits({ ...input, route: 'advice' }),
    ).resolves.toEqual({ allowed: true });
    await expect(
      applyPaidRouteLimits({ ...input, route: 'advice' }),
    ).resolves.toMatchObject({ allowed: false, window: 'burst' });

    await expect(
      applyPaidRouteLimits({ ...input, route: 'extract' }),
    ).resolves.toEqual({ allowed: true });
    await expect(
      applyPaidRouteLimits({ ...input, route: 'translate-notes' }),
    ).resolves.toEqual({ allowed: true });

    expect(limiters.adviceBurst.calls).toHaveLength(2);
    expect(limiters.extractBurst.calls).toHaveLength(1);
    expect(limiters.translateNotesBurst.calls).toHaveLength(1);
  });

  it('charges a shared daily pool by route cost', async () => {
    const limiters = fakeLimiters({ now: () => 2_000, dailyUnits: 6 });
    const input = { identifier: 'same-ip', limiters, config: COSTS };

    await expect(
      applyPaidRouteLimits({ ...input, route: 'extract' }),
    ).resolves.toEqual({ allowed: true });
    await expect(
      applyPaidRouteLimits({ ...input, route: 'translate-notes' }),
    ).resolves.toEqual({ allowed: true });
    await expect(
      applyPaidRouteLimits({ ...input, route: 'translate-notes' }),
    ).resolves.toMatchObject({ allowed: false, window: 'daily' });

    expect(limiters.dailyCost.calls).toEqual([
      { identifier: 'same-ip', rate: 5 },
      { identifier: 'same-ip', rate: 1 },
      { identifier: 'same-ip', rate: 1 },
    ]);
  });

  it('debits advice at three units from the daily pool shared by every route', async () => {
    const limiters = fakeLimiters({ now: () => 2_500, dailyUnits: 9 });
    const input = { identifier: 'same-ip', limiters, config: COSTS };

    await expect(
      applyPaidRouteLimits({ ...input, route: 'extract' }),
    ).resolves.toEqual({ allowed: true });
    await expect(
      applyPaidRouteLimits({ ...input, route: 'advice' }),
    ).resolves.toEqual({ allowed: true });
    await expect(
      applyPaidRouteLimits({ ...input, route: 'translate-notes' }),
    ).resolves.toEqual({ allowed: true });
    await expect(
      applyPaidRouteLimits({ ...input, route: 'advice' }),
    ).resolves.toMatchObject({ allowed: false, window: 'daily' });

    expect(limiters.dailyCost.calls).toEqual([
      { identifier: 'same-ip', rate: 5 },
      { identifier: 'same-ip', rate: 3 },
      { identifier: 'same-ip', rate: 1 },
      { identifier: 'same-ip', rate: 3 },
    ]);
  });

  it('keeps different IP identifiers in separate burst and daily buckets', async () => {
    const limiters = fakeLimiters({
      now: () => 3_000,
      extractBurst: 1,
      dailyUnits: 5,
    });
    const input = { limiters, config: COSTS, route: 'extract' as const };

    await expect(
      applyPaidRouteLimits({ ...input, identifier: 'ip-a' }),
    ).resolves.toEqual({ allowed: true });
    await expect(
      applyPaidRouteLimits({ ...input, identifier: 'ip-b' }),
    ).resolves.toEqual({ allowed: true });
    await expect(
      applyPaidRouteLimits({ ...input, identifier: 'ip-a' }),
    ).resolves.toMatchObject({ allowed: false, window: 'burst' });
  });

  it('allows a burst request after the full sliding window has elapsed', async () => {
    let now = 10_000;
    const limiters = fakeLimiters({
      now: () => now,
      extractBurst: 1,
      burstWindowMs: 60_000,
    });
    const input = {
      route: 'extract' as const,
      identifier: 'same-ip',
      limiters,
      config: COSTS,
    };

    await expect(applyPaidRouteLimits(input)).resolves.toEqual({ allowed: true });
    await expect(applyPaidRouteLimits(input)).resolves.toMatchObject({
      allowed: false,
      window: 'burst',
    });

    now = 70_001;
    await expect(applyPaidRouteLimits(input)).resolves.toEqual({ allowed: true });
  });

  it('allows advice again after its full sliding window has elapsed', async () => {
    let now = 20_000;
    const limiters = fakeLimiters({
      now: () => now,
      adviceBurst: 1,
      burstWindowMs: 60_000,
    });
    const input = {
      route: 'advice' as const,
      identifier: 'same-ip',
      limiters,
      config: COSTS,
    };

    await expect(applyPaidRouteLimits(input)).resolves.toEqual({ allowed: true });
    await expect(applyPaidRouteLimits(input)).resolves.toMatchObject({
      allowed: false,
      window: 'burst',
    });

    now = 80_001;
    await expect(applyPaidRouteLimits(input)).resolves.toEqual({ allowed: true });
  });

  it('allows daily spend again after the daily window resets', async () => {
    let now = 10_000;
    const limiters = fakeLimiters({
      now: () => now,
      extractBurst: 100,
      dailyUnits: 5,
      dailyWindowMs: 86_400_000,
    });
    const input = {
      route: 'extract' as const,
      identifier: 'same-ip',
      limiters,
      config: COSTS,
    };

    await expect(applyPaidRouteLimits(input)).resolves.toEqual({ allowed: true });
    await expect(applyPaidRouteLimits(input)).resolves.toMatchObject({
      allowed: false,
      resetAt: 86_400_000,
      window: 'daily',
    });

    now = 86_400_000;
    await expect(applyPaidRouteLimits(input)).resolves.toEqual({ allowed: true });
  });

  it('fails closed when Upstash reports a burst timeout as success', async () => {
    const dailyLimit = vi.fn();
    const timeoutLimiter: SharedWindowLimiter = {
      limit: vi.fn().mockResolvedValue({
        success: true,
        reset: 60_000,
        reason: 'timeout',
      }),
      setDynamicLimit: vi.fn(),
    };
    const limiters: PaidRouteLimiters = {
      extractBurst: timeoutLimiter,
      translateNotesBurst: timeoutLimiter,
      adviceBurst: timeoutLimiter,
      dailyCost: {
        limit: dailyLimit,
        setDynamicLimit: vi.fn(),
      },
    };

    await expect(
      applyPaidRouteLimits({
        route: 'extract',
        identifier: 'same-ip',
        limiters,
        config: COSTS,
      }),
    ).rejects.toBeInstanceOf(RateLimitStoreUnavailableError);
    expect(dailyLimit).not.toHaveBeenCalled();
  });

  it('fails closed when the advice burst store request times out', async () => {
    const dailyLimit = vi.fn();
    const timeoutLimiter: SharedWindowLimiter = {
      limit: vi.fn().mockResolvedValue({
        success: true,
        reset: 60_000,
        reason: 'timeout',
      }),
      setDynamicLimit: vi.fn(),
    };
    const unusedLimiter: SharedWindowLimiter = {
      limit: vi.fn(),
      setDynamicLimit: vi.fn(),
    };

    await expect(
      applyPaidRouteLimits({
        route: 'advice',
        identifier: 'same-ip',
        limiters: {
          extractBurst: unusedLimiter,
          translateNotesBurst: unusedLimiter,
          adviceBurst: timeoutLimiter,
          dailyCost: {
            limit: dailyLimit,
            setDynamicLimit: vi.fn(),
          },
        },
        config: COSTS,
      }),
    ).rejects.toBeInstanceOf(RateLimitStoreUnavailableError);
    expect(dailyLimit).not.toHaveBeenCalled();
    expect(unusedLimiter.limit).not.toHaveBeenCalled();
  });

  it('fails closed when the daily store request times out', async () => {
    const allowedBurst: SharedWindowLimiter = {
      limit: vi.fn().mockResolvedValue({ success: true, reset: 60_000 }),
      setDynamicLimit: vi.fn(),
    };
    const timedOutDaily: SharedWindowLimiter = {
      limit: vi.fn().mockResolvedValue({
        success: true,
        reset: 86_400_000,
        reason: 'timeout',
      }),
      setDynamicLimit: vi.fn(),
    };

    await expect(
      applyPaidRouteLimits({
        route: 'translate-notes',
        identifier: 'same-ip',
        limiters: {
          extractBurst: allowedBurst,
          translateNotesBurst: allowedBurst,
          adviceBurst: allowedBurst,
          dailyCost: timedOutDaily,
        },
        config: COSTS,
      }),
    ).rejects.toBeInstanceOf(RateLimitStoreUnavailableError);
  });
});

describe('rateLimitedResponse', () => {
  it('returns a private bilingual daily-window 429 with an honest Retry-After', async () => {
    const response = rateLimitedResponse(
      { allowed: false, resetAt: 12_501, window: 'daily' },
      10_000,
    );
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Retry-After')).toBe('3');
    expect(body).toEqual({
      error: RATE_LIMITED_MESSAGE.en,
      errorZh: RATE_LIMITED_MESSAGE.zh,
    });

    const serialized = JSON.stringify(body);
    for (const internal of [
      REQUIRED_ENV.UPSTASH_REDIS_REST_URL,
      REQUIRED_ENV.UPSTASH_REDIS_REST_TOKEN,
      REQUIRED_ENV.RATE_LIMIT_IP_HASH_SECRET,
      '203.0.113.77',
      'Upstash',
      'Redis',
    ]) {
      expect(serialized).not.toContain(internal);
    }
  });

  it('uses a minimum one-second Retry-After for an expired daily reset', () => {
    expect(
      rateLimitedResponse(
        { allowed: false, resetAt: 5_000, window: 'daily' },
        6_000,
      ).headers.get('Retry-After'),
    ).toBe('1');
  });

  it('does not misrepresent the approximate sliding-window reset as Retry-After', () => {
    expect(
      rateLimitedResponse(
        { allowed: false, resetAt: 12_501, window: 'burst' },
        10_000,
      ).headers.has('Retry-After'),
    ).toBe(false);
  });
});

describe('enforcePaidRouteRateLimit', () => {
  it('fails closed with a generic bilingual 503 when configuration is missing', async () => {
    vi.resetModules();
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
    vi.stubEnv('RATE_LIMIT_IP_HASH_SECRET', '');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      const freshModule = await import('./rateLimit');
      const response = await freshModule.enforcePaidRouteRateLimit(
        {
          headers: new Headers({
            'x-vercel-forwarded-for': '203.0.113.99',
          }),
        },
        'extract',
      );
      const body = await response?.json();

      expect(response?.status).toBe(503);
      expect(response?.headers.get('Cache-Control')).toBe('no-store');
      expect(body).toEqual({
        error: freshModule.RATE_LIMIT_UNAVAILABLE_MESSAGE.en,
        errorZh: freshModule.RATE_LIMIT_UNAVAILABLE_MESSAGE.zh,
      });
      expect(consoleError).toHaveBeenCalledWith(
        'paid route rate limit unavailable',
        { route: 'extract', cause: 'configuration' },
      );
      expect(JSON.stringify({ body, calls: consoleError.mock.calls })).not.toContain(
        '203.0.113.99',
      );
    } finally {
      consoleError.mockRestore();
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });

  it('turns Upstash timeout fail-open output into a private 503', async () => {
    vi.resetModules();

    class TimeoutRatelimit {
      static slidingWindow() {
        return { kind: 'sliding' };
      }

      static fixedWindow() {
        return { kind: 'fixed' };
      }

      readonly limit = vi.fn().mockResolvedValue({
        success: true,
        reset: 0,
        reason: 'timeout',
      });
      readonly setDynamicLimit = vi.fn();
    }

    class FakeRedis {}

    vi.doMock('@upstash/ratelimit', () => ({ Ratelimit: TimeoutRatelimit }));
    vi.doMock('@upstash/redis', () => ({ Redis: FakeRedis }));
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://private-store.example');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'private-store-token');
    vi.stubEnv(
      'RATE_LIMIT_IP_HASH_SECRET',
      REQUIRED_ENV.RATE_LIMIT_IP_HASH_SECRET,
    );
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      const freshModule = await import('./rateLimit');
      const response = await freshModule.enforcePaidRouteRateLimit(
        {
          headers: new Headers({
            'x-vercel-forwarded-for': '203.0.113.100',
          }),
        },
        'translate-notes',
      );
      const body = await response?.json();
      const observable = JSON.stringify({
        body,
        calls: consoleError.mock.calls,
      });

      expect(response?.status).toBe(503);
      expect(body).toEqual({
        error: freshModule.RATE_LIMIT_UNAVAILABLE_MESSAGE.en,
        errorZh: freshModule.RATE_LIMIT_UNAVAILABLE_MESSAGE.zh,
      });
      expect(consoleError).toHaveBeenCalledWith(
        'paid route rate limit unavailable',
        { route: 'translate-notes', cause: 'store-unavailable' },
      );
      expect(observable).not.toContain('private-store.example');
      expect(observable).not.toContain('private-store-token');
      expect(observable).not.toContain('203.0.113.100');
    } finally {
      consoleError.mockRestore();
      vi.doUnmock('@upstash/ratelimit');
      vi.doUnmock('@upstash/redis');
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });
});

describe('setDynamicRateLimitOverride', () => {
  it('rejects invalid override limits before touching production state', async () => {
    await expect(
      setDynamicRateLimitOverride('daily-units', 0),
    ).rejects.toBeInstanceOf(RateLimitConfigurationError);
    await expect(
      setDynamicRateLimitOverride('extract-burst', 1.5),
    ).rejects.toBeInstanceOf(RateLimitConfigurationError);
  });

  it('maps each operator target to the intended shared limiter', async () => {
    vi.resetModules();

    const created: Array<{
      prefix: string;
      setDynamicLimit: ReturnType<typeof vi.fn>;
    }> = [];

    class FakeRatelimit {
      static slidingWindow() {
        return { kind: 'sliding' };
      }

      static fixedWindow() {
        return { kind: 'fixed' };
      }

      readonly limit = vi.fn();
      readonly setDynamicLimit = vi.fn(async (_options: { limit: number | false }) => {});

      constructor(options: { prefix: string }) {
        created.push({
          prefix: options.prefix,
          setDynamicLimit: this.setDynamicLimit,
        });
      }
    }

    class FakeRedis {}

    vi.doMock('@upstash/ratelimit', () => ({ Ratelimit: FakeRatelimit }));
    vi.doMock('@upstash/redis', () => ({ Redis: FakeRedis }));
    vi.stubEnv('UPSTASH_REDIS_REST_URL', REQUIRED_ENV.UPSTASH_REDIS_REST_URL);
    vi.stubEnv(
      'UPSTASH_REDIS_REST_TOKEN',
      REQUIRED_ENV.UPSTASH_REDIS_REST_TOKEN,
    );
    vi.stubEnv(
      'RATE_LIMIT_IP_HASH_SECRET',
      REQUIRED_ENV.RATE_LIMIT_IP_HASH_SECRET,
    );
    vi.stubEnv('RATE_LIMIT_NAMESPACE', 'unit-test');

    try {
      const freshModule = await import('./rateLimit');

      await freshModule.setDynamicRateLimitOverride('extract-burst', 2);
      await freshModule.setDynamicRateLimitOverride('translate-notes-burst', 7);
      await freshModule.setDynamicRateLimitOverride('advice-burst', 5);
      await freshModule.setDynamicRateLimitOverride('daily-units', 41);
      await freshModule.setDynamicRateLimitOverride('extract-burst', false);

      expect(created.map(({ prefix }) => prefix)).toEqual([
        'health-translator:unit-test:paid-api:v1:extract:burst',
        'health-translator:unit-test:paid-api:v1:translate-notes:burst',
        'health-translator:unit-test:paid-api:v1:advice:burst',
        'health-translator:unit-test:paid-api:v1:daily-cost',
      ]);
      expect(created[0].setDynamicLimit).toHaveBeenNthCalledWith(1, {
        limit: 2,
      });
      expect(created[0].setDynamicLimit).toHaveBeenNthCalledWith(2, {
        limit: false,
      });
      expect(created[1].setDynamicLimit).toHaveBeenCalledWith({ limit: 7 });
      expect(created[2].setDynamicLimit).toHaveBeenCalledWith({ limit: 5 });
      expect(created[3].setDynamicLimit).toHaveBeenCalledWith({ limit: 41 });
    } finally {
      vi.doUnmock('@upstash/ratelimit');
      vi.doUnmock('@upstash/redis');
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });
});

describe('redis credential env-name compatibility', () => {
  // Regression: the Upstash SDK convention and Vercel's Marketplace integration use
  // DIFFERENT variable names, and Vercel's "custom prefix" cannot produce the SDK's
  // names — it prepends to fixed suffixes (prefix `UPSTASH_REDIS_REST` yields
  // UPSTASH_REDIS_REST_KV_REST_API_URL). Accepting only one convention meant the
  // limiter failed closed on the other, and a 503 on every paid route looks exactly
  // like an outage rather than a misnamed variable.
  const base = {
    RATE_LIMIT_IP_HASH_SECRET: 'x'.repeat(32),
  };

  it('accepts the Upstash SDK names (local development)', () => {
    const config = readRateLimitConfig({
      ...base,
      UPSTASH_REDIS_REST_URL: 'https://example.upstash.io',
      UPSTASH_REDIS_REST_TOKEN: 'token-a',
    });
    expect(config.redisUrl).toBe('https://example.upstash.io');
    expect(config.redisToken).toBe('token-a');
  });

  it('accepts the Vercel integration names (KV_REST_API_*)', () => {
    const config = readRateLimitConfig({
      ...base,
      KV_REST_API_URL: 'https://example.upstash.io',
      KV_REST_API_TOKEN: 'token-b',
    });
    expect(config.redisUrl).toBe('https://example.upstash.io');
    expect(config.redisToken).toBe('token-b');
  });

  it('still fails closed when neither convention is present, and names both in the error', () => {
    expect(() => readRateLimitConfig({ ...base })).toThrow(RateLimitConfigurationError);
    expect(() => readRateLimitConfig({ ...base })).toThrow(/UPSTASH_REDIS_REST_URL/);
    expect(() => readRateLimitConfig({ ...base })).toThrow(/KV_REST_API_URL/);
  });

  it('does NOT accept a prefixed variant — reconnect without a prefix instead', () => {
    // Encoding one team's accidental connect-time prefix would make the config
    // silently environment-specific.
    expect(() =>
      readRateLimitConfig({
        ...base,
        UPSTASH_REDIS_REST_KV_REST_API_URL: 'https://example.upstash.io',
        UPSTASH_REDIS_REST_KV_REST_API_TOKEN: 'token-c',
      }),
    ).toThrow(RateLimitConfigurationError);
  });
});
