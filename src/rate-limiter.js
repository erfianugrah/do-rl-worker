import { generateFingerprint } from './fingerprint.js';
import { config } from './config.js';

export class RateLimiter {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    const fingerprint = await generateFingerprint(request, this.env);
    const key = `rate_limit:${fingerprint}`;
    let bucket = await this.state.storage.get(key);
    const now = Math.floor(Date.now() / 1000);

    if (!bucket) {
      console.log('RateLimiter: No existing bucket, creating new one');
      bucket = { tokens: config.rateLimit.limit, lastRefill: now };
    } else {
      console.log('RateLimiter: Existing bucket:', bucket);
      const elapsed = Math.max(0, now - bucket.lastRefill);
      const rate = config.rateLimit.limit / config.rateLimit.period;
      bucket.tokens = Math.min(config.rateLimit.limit, bucket.tokens + elapsed * rate);
      bucket.lastRefill = now;
    }

    console.log('RateLimiter: Current tokens:', bucket.tokens);

    if (bucket.tokens >= 1) {
      console.log('RateLimiter: Request allowed');
      bucket.tokens -= 1;
      await this.state.storage.put(key, bucket);

      const resetTime = Math.ceil(
        now + (1 - bucket.tokens) / (config.rateLimit.limit / config.rateLimit.period)
      );
      return new Response(null, {
        status: 200,
        headers: {
          'X-Rate-Limit-Remaining': bucket.tokens.toFixed(6),
          'X-Rate-Limit-Limit': config.rateLimit.limit.toString(),
          'X-Rate-Limit-Period': config.rateLimit.period.toString(),
          'X-Rate-Limit-Reset': resetTime.toString(),
        },
      });
    } else {
      console.log('RateLimiter: Rate limit exceeded');
      const retryAfter = Math.max(
        0,
        (1 - bucket.tokens) / (config.rateLimit.limit / config.rateLimit.period)
      ).toFixed(3);
      return new Response('Rate limit exceeded', {
        status: 429,
        headers: {
          'Retry-After': retryAfter,
          'X-Rate-Limit-Limit': config.rateLimit.limit.toString(),
          'X-Rate-Limit-Period': config.rateLimit.period.toString(),
          'X-Rate-Limit-Reset': Math.ceil(now + parseFloat(retryAfter)).toString(),
        },
      });
    }
  }

  async getRateLimitInfo(request) {
    const fingerprint = await generateFingerprint(request, this.env);
    const key = `rate_limit:${fingerprint}`;
    let bucket = await this.state.storage.get(key);
    const now = Math.floor(Date.now() / 1000);

    if (!bucket) {
      bucket = { tokens: config.rateLimit.limit, lastRefill: now };
    } else {
      const elapsed = Math.max(0, now - bucket.lastRefill);
      const rate = config.rateLimit.limit / config.rateLimit.period;
      bucket.tokens = Math.min(config.rateLimit.limit, bucket.tokens + elapsed * rate);
    }

    return {
      limit: config.rateLimit.limit,
      period: config.rateLimit.period,
      remaining: Math.floor(bucket.tokens),
      reset: Math.ceil(
        now +
          (config.rateLimit.limit - bucket.tokens) /
            (config.rateLimit.limit / config.rateLimit.period)
      ),
    };
  }
}
