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

    if (!config || !config.rateLimit) {
      console.error('RateLimiter: Invalid or missing configuration');
      return new Response(null, {
        status: 200,
        headers: { 'X-Rate-Limit-Bypassed': 'Invalid or missing configuration' },
      });
    }

    // Ensure fingerprint config exists, even if empty
    config.fingerprint = config.fingerprint || { parameters: ['clientIP'] };

    try {
      const fingerprint = await generateFingerprint(request, this.env, config.fingerprint);
      const ip = request.headers.get('CF-Connecting-IP');
      const token = request.headers.get('X-Rate-Limit-Token');

      const fingerprintKey = `rate_limit:fingerprint:${fingerprint}`;
      const ipKey = `rate_limit:ip:${ip}`;

      const now = Math.floor(Date.now() / 1000);

      let fingerprintBucket = await this.getBucket(fingerprintKey, config.rateLimit.limit, now);
      let ipBucket = config.rateLimit.ipLimit
        ? await this.getBucket(ipKey, config.rateLimit.ipLimit, now)
        : null;

      fingerprintBucket = this.refillBucket(
        fingerprintBucket,
        config.rateLimit.limit,
        config.rateLimit.period,
        now
      );
      if (ipBucket) {
        ipBucket = this.refillBucket(
          ipBucket,
          config.rateLimit.ipLimit,
          config.rateLimit.ipPeriod || config.rateLimit.period,
          now
        );
      }

      console.log('RateLimiter: Fingerprint bucket:', fingerprintBucket);
      if (ipBucket) console.log('RateLimiter: IP bucket:', ipBucket);

      if (fingerprintBucket.tokens >= 1 && (!ipBucket || ipBucket.tokens >= 1)) {
        console.log('RateLimiter: Request allowed');
        fingerprintBucket.tokens -= 1;
        if (ipBucket) ipBucket.tokens -= 1;
        await this.state.storage.put(fingerprintKey, fingerprintBucket);
        if (ipBucket) await this.state.storage.put(ipKey, ipBucket);

        const resetTime = Math.ceil(
          now +
            Math.max(
              (1 - fingerprintBucket.tokens) / (config.rateLimit.limit / config.rateLimit.period),
              ipBucket
                ? (1 - ipBucket.tokens) /
                    (config.rateLimit.ipLimit /
                      (config.rateLimit.ipPeriod || config.rateLimit.period))
                : 0
            )
        );

        return new Response(null, {
          status: 200,
          headers: {
            'X-Rate-Limit-Remaining': Math.min(
              fingerprintBucket.tokens,
              ipBucket ? ipBucket.tokens : Infinity
            ).toFixed(6),
            'X-Rate-Limit-Limit': config.rateLimit.limit.toString(),
            'X-Rate-Limit-Period': config.rateLimit.period.toString(),
            'X-Rate-Limit-Reset': resetTime.toString(),
          },
        });
      } else {
        console.log('RateLimiter: Rate limit exceeded');
        const retryAfter = Math.max(
          (1 - fingerprintBucket.tokens) / (config.rateLimit.limit / config.rateLimit.period),
          ipBucket
            ? (1 - ipBucket.tokens) /
                (config.rateLimit.ipLimit / (config.rateLimit.ipPeriod || config.rateLimit.period))
            : 0
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

  async getBucket(key, limit, now) {
    let bucket = await this.state.storage.get(key);
    if (!bucket) {
      bucket = { tokens: limit, lastRefill: now };
    }
    return bucket;
  }

  refillBucket(bucket, limit, period, now) {
    const elapsed = Math.max(0, now - bucket.lastRefill);
    const rate = limit / period;
    bucket.tokens = Math.min(limit, bucket.tokens + elapsed * rate);
    bucket.lastRefill = now;
    return bucket;
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

    if (!config || !config.rateLimit) {
      console.error('RateLimiter: Invalid or missing configuration');
      return new Response(JSON.stringify({ error: 'Invalid or missing configuration' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Ensure fingerprint config exists, even if empty
    config.fingerprint = config.fingerprint || { parameters: ['clientIP'] };

    const fingerprint = await generateFingerprint(request, this.env, config.fingerprint);
    const ip = request.headers.get('CF-Connecting-IP');

    const fingerprintKey = `rate_limit:fingerprint:${fingerprint}`;
    const ipKey = `rate_limit:ip:${ip}`;

    const now = Math.floor(Date.now() / 1000);

    let fingerprintBucket = await this.getBucket(fingerprintKey, config.rateLimit.limit, now);
    let ipBucket = config.rateLimit.ipLimit
      ? await this.getBucket(ipKey, config.rateLimit.ipLimit, now)
      : null;

    fingerprintBucket = this.refillBucket(
      fingerprintBucket,
      config.rateLimit.limit,
      config.rateLimit.period,
      now
    );
    if (ipBucket) {
      ipBucket = this.refillBucket(
        ipBucket,
        config.rateLimit.ipLimit,
        config.rateLimit.ipPeriod || config.rateLimit.period,
        now
      );
    }

    return new Response(
      JSON.stringify({
        limit: config.rateLimit.limit,
        period: config.rateLimit.period,
        remaining: Math.min(fingerprintBucket.tokens, ipBucket ? ipBucket.tokens : Infinity),
        reset: Math.ceil(
          now +
            Math.max(
              (config.rateLimit.limit - fingerprintBucket.tokens) /
                (config.rateLimit.limit / config.rateLimit.period),
              ipBucket
                ? (config.rateLimit.ipLimit - ipBucket.tokens) /
                    (config.rateLimit.ipLimit /
                      (config.rateLimit.ipPeriod || config.rateLimit.period))
                : 0
            )
        ),
      }),
      {
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}
