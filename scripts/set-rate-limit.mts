import nextEnv from '@next/env';
import {
  setDynamicRateLimitOverride,
  type DynamicRateLimitTarget,
} from '../lib/rateLimit';

const TARGETS = new Set<DynamicRateLimitTarget>([
  'extract-burst',
  'translate-notes-burst',
  'advice-burst',
  'daily-units',
]);

const USAGE =
  'Usage: npm run rate-limit:set -- <extract-burst|translate-notes-burst|advice-burst|daily-units> <positive integer|default>';

function parseArguments(
  args: string[],
): { target: DynamicRateLimitTarget; limit: number | false } | null {
  if (args.length !== 2) return null;

  const [rawTarget, rawLimit] = args;
  if (!TARGETS.has(rawTarget as DynamicRateLimitTarget)) return null;

  if (rawLimit === 'default') {
    return {
      target: rawTarget as DynamicRateLimitTarget,
      limit: false,
    };
  }

  if (!/^[1-9]\d*$/.test(rawLimit)) return null;
  const limit = Number(rawLimit);
  if (!Number.isSafeInteger(limit)) return null;

  return {
    target: rawTarget as DynamicRateLimitTarget,
    limit,
  };
}

async function main(): Promise<void> {
  const parsed = parseArguments(process.argv.slice(2));
  if (!parsed) {
    console.error(USAGE);
    process.exitCode = 2;
    return;
  }

  // Match Next's local configuration behavior so the documented operator
  // command works after credentials are placed in .env.local. Existing shell
  // variables retain precedence, which is important when targeting production.
  nextEnv.loadEnvConfig(process.cwd(), true);
  await setDynamicRateLimitOverride(parsed.target, parsed.limit);

  const result =
    parsed.limit === false
      ? 'cleared; the deployed environment default now applies'
      : `set to ${parsed.limit}`;
  console.log(`Rate-limit override for ${parsed.target} ${result}.`);
}

main().catch(() => {
  // Do not print the caught error: Redis errors can include endpoint or
  // credential details.
  console.error(
    'Could not update the rate-limit override. Check the configured rate-limit environment variables and shared store.',
  );
  process.exitCode = 1;
});
