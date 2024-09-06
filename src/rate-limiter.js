import { generateFingerprint } from './fingerprint.js';

export class RateLimiter {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    let config;
    try {
      config = JSON.parse(request.headers.get('X-Rate-Limit-Config'));
    } catch (error) {
      console.error('RateLimiter: Error parsing config:', error);
      return new Response(null, {
        status: 200,
        headers: { 'X-Rate-Limit-Bypassed': 'Config parsing error' },
      });
    }

    console.log('RateLimiter: Received config:', JSON.stringify(config, null, 2));

    if (!config || !config.fingerprint || !config.rateLimit) {
      console.error('RateLimiter: Invalid or missing configuration');
      return new Response(null, {
        status: 200,
        headers: { 'X-Rate-Limit-Bypassed': 'Invalid or missing configuration' },
      });
    }

    try {
      const fingerprint = await generateFingerprint(request, this.env, config.fingerprint);
      console.log('RateLimiter: Generated fingerprint:', fingerprint);

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
        return new Response(null, {
          status: 429,
          headers: {
            'Retry-After': retryAfter,
            'X-Rate-Limit-Limit': config.rateLimit.limit.toString(),
            'X-Rate-Limit-Period': config.rateLimit.period.toString(),
            'X-Rate-Limit-Reset': Math.ceil(now + parseFloat(retryAfter)).toString(),
          },
        });
      }
    } catch (error) {
      console.error('RateLimiter: Unexpected error:', error);
      return new Response(null, {
        status: 200,
        headers: { 'X-Rate-Limit-Bypassed': 'Unexpected error' },
      });
    }
  }

  async getRateLimitInfo(request) {
    let config;
    try {
      config = JSON.parse(request.headers.get('X-Rate-Limit-Config'));
    } catch (error) {
      console.error('RateLimiter: Error parsing config:', error);
      return new Response(JSON.stringify({ error: 'Config parsing error' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!config || !config.fingerprint || !config.rateLimit) {
      console.error('RateLimiter: Invalid or missing configuration');
      return new Response(JSON.stringify({ error: 'Invalid or missing configuration' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    try {
      const fingerprint = await generateFingerprint(request, this.env, config.fingerprint);
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

      return new Response(
        JSON.stringify({
          limit: config.rateLimit.limit,
          period: config.rateLimit.period,
          remaining: Math.floor(bucket.tokens),
          reset: Math.ceil(
            now +
              (config.rateLimit.limit - bucket.tokens) /
                (config.rateLimit.limit / config.rateLimit.period)
          ),
        }),
        {
          headers: { 'Content-Type': 'application/json' },
        }
      );
    } catch (error) {
      console.error('RateLimiter: Unexpected error:', error);
      return new Response(JSON.stringify({ error: 'Unexpected error' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }
}
