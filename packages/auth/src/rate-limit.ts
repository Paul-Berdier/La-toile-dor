/**
 * Limitation de débit en mémoire (fenêtre glissante simplifiée).
 * Suffisant pour un service Railway mono-instance ; si l'application passe en
 * multi-instances, remplacer par un limiteur partagé (PostgreSQL ou Redis).
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export function rateLimit(
  key: string,
  maxAttempts: number,
  windowSeconds: number,
): RateLimitResult {
  cleanupRateLimits();
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
    return { allowed: true, remaining: maxAttempts - 1, retryAfterSeconds: 0 };
  }

  bucket.count += 1;
  if (bucket.count > maxAttempts) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000),
    };
  }
  return {
    allowed: true,
    remaining: maxAttempts - bucket.count,
    retryAfterSeconds: 0,
  };
}

// Nettoyage périodique pour éviter la croissance sans borne
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;
let lastCleanup = Date.now();

export function cleanupRateLimits(): void {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}
