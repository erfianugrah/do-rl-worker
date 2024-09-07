import { generateFingerprint } from './fingerprint.js';

export class RateLimiter {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    console.log('RateLimiter: Received request');
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

    console.log('RateLimiter: Received config:', JSON.stringify(config, null, 2));

    if (!config || !config.rateLimit || !config.rateLimit.ipLimit) {
      console.error('RateLimiter: Invalid or missing configuration');
      return new Response(JSON.stringify({ error: 'Invalid or missing configuration' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Check if this is a rate limit info request
    if (request.url.endsWith('/_ratelimit')) {
      return this.getRateLimitInfo(request, config);
    }

    try {
      const ip = request.headers.get('CF-Connecting-IP');
      console.log('RateLimiter: Client IP:', ip);
      const ipKey = `rate_limit:ip:${ip}`;
      const now = Math.floor(Date.now() / 1000);

      let ipBucket = await this.getBucket(ipKey, config.rateLimit.ipLimit, now);
      ipBucket = this.refillBucket(
        ipBucket,
        config.rateLimit.ipLimit,
        config.rateLimit.ipPeriod,
        now
      );

      console.log('RateLimiter: IP bucket:', JSON.stringify(ipBucket, null, 2));

      let fingerprintBucket = null;
      let fingerprint = null;
      if (config.rateLimit.limit && config.fingerprint) {
        console.log('RateLimiter: Generating fingerprint');
        fingerprint = await generateFingerprint(request, this.env, config.fingerprint);
        console.log('RateLimiter: Generated fingerprint:', fingerprint);
        const fingerprintKey = `rate_limit:fingerprint:${fingerprint}`;
        fingerprintBucket = await this.getBucket(fingerprintKey, config.rateLimit.limit, now);
        fingerprintBucket = this.refillBucket(
          fingerprintBucket,
          config.rateLimit.limit,
          config.rateLimit.period,
          now
        );
        console.log('RateLimiter: Fingerprint bucket:', JSON.stringify(fingerprintBucket, null, 2));
      }

      const isAllowed =
        ipBucket.tokens >= 1 && (!fingerprintBucket || fingerprintBucket.tokens >= 1);

      if (isAllowed) {
        console.log('RateLimiter: Request allowed');
        ipBucket.tokens -= 1;
        await this.state.storage.put(ipKey, ipBucket);
        if (fingerprintBucket) {
          fingerprintBucket.tokens -= 1;
          await this.state.storage.put(`rate_limit:fingerprint:${fingerprint}`, fingerprintBucket);
        }

        const resetTime = Math.ceil(
          now +
            Math.max(
              (1 - ipBucket.tokens) / (config.rateLimit.ipLimit / config.rateLimit.ipPeriod),
              fingerprintBucket
                ? (1 - fingerprintBucket.tokens) /
                    (config.rateLimit.limit / config.rateLimit.period)
                : 0
            )
        );

        return new Response(
          JSON.stringify({
            allowed: true,
            remaining: Math.min(
              ipBucket.tokens,
              fingerprintBucket ? fingerprintBucket.tokens : Infinity
            ),
            limit: Math.min(config.rateLimit.ipLimit, config.rateLimit.limit || Infinity),
            period: Math.max(config.rateLimit.ipPeriod, config.rateLimit.period || 0),
            reset: resetTime,
          }),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
              'X-Rate-Limit-Remaining': Math.min(
                ipBucket.tokens,
                fingerprintBucket ? fingerprintBucket.tokens : Infinity
              ).toFixed(6),
              'X-Rate-Limit-Limit': Math.min(
                config.rateLimit.ipLimit,
                config.rateLimit.limit || Infinity
              ).toString(),
              'X-Rate-Limit-Period': Math.max(
                config.rateLimit.ipPeriod,
                config.rateLimit.period || 0
              ).toString(),
              'X-Rate-Limit-Reset': resetTime.toString(),
            },
          }
        );
      } else {
        console.log('RateLimiter: Rate limit exceeded');
        const retryAfter = Math.max(
          (1 - ipBucket.tokens) / (config.rateLimit.ipLimit / config.rateLimit.ipPeriod),
          fingerprintBucket
            ? (1 - fingerprintBucket.tokens) / (config.rateLimit.limit / config.rateLimit.period)
            : 0
        ).toFixed(3);

        return new Response(
          JSON.stringify({
            allowed: false,
            retryAfter: parseFloat(retryAfter),
            limit: Math.min(config.rateLimit.ipLimit, config.rateLimit.limit || Infinity),
            period: Math.max(config.rateLimit.ipPeriod, config.rateLimit.period || 0),
            reset: Math.ceil(now + parseFloat(retryAfter)),
          }),
          {
            status: 429,
            headers: {
              'Content-Type': 'application/json',
              'Retry-After': retryAfter,
              'X-Rate-Limit-Limit': Math.min(
                config.rateLimit.ipLimit,
                config.rateLimit.limit || Infinity
              ).toString(),
              'X-Rate-Limit-Period': Math.max(
                config.rateLimit.ipPeriod,
                config.rateLimit.period || 0
              ).toString(),
              'X-Rate-Limit-Reset': Math.ceil(now + parseFloat(retryAfter)).toString(),
            },
          }
        );
      }
    } catch (error) {
      console.error('RateLimiter: Unexpected error:', error);
      return new Response(JSON.stringify({ error: 'Unexpected error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  async getRateLimitInfo(request, config) {
    console.log('RateLimiter: Getting rate limit info');

    try {
      const ip = request.headers.get('CF-Connecting-IP');
      console.log('RateLimiter: Client IP for info:', ip);
      const ipKey = `rate_limit:ip:${ip}`;
      const now = Math.floor(Date.now() / 1000);

      let ipBucket = await this.getBucket(ipKey, config.rateLimit.ipLimit, now);
      ipBucket = this.refillBucket(
        ipBucket,
        config.rateLimit.ipLimit,
        config.rateLimit.ipPeriod,
        now
      );

      console.log('RateLimiter: IP bucket for info:', JSON.stringify(ipBucket, null, 2));

      let fingerprintBucket = null;
      let fingerprint = null;
      if (config.rateLimit.limit && config.fingerprint) {
        console.log('RateLimiter: Generating fingerprint for info');
        fingerprint = await generateFingerprint(request, this.env, config.fingerprint);
        console.log('RateLimiter: Generated fingerprint for info:', fingerprint);
        const fingerprintKey = `rate_limit:fingerprint:${fingerprint}`;
        fingerprintBucket = await this.getBucket(fingerprintKey, config.rateLimit.limit, now);
        fingerprintBucket = this.refillBucket(
          fingerprintBucket,
          config.rateLimit.limit,
          config.rateLimit.period,
          now
        );
        console.log(
          'RateLimiter: Fingerprint bucket for info:',
          JSON.stringify(fingerprintBucket, null, 2)
        );
      }

      const resetTime = Math.ceil(
        now +
          Math.max(
            (config.rateLimit.ipLimit - ipBucket.tokens) /
              (config.rateLimit.ipLimit / config.rateLimit.ipPeriod),
            fingerprintBucket
              ? (config.rateLimit.limit - fingerprintBucket.tokens) /
                  (config.rateLimit.limit / config.rateLimit.period)
              : 0
          )
      );

      return new Response(
        JSON.stringify({
          ip: {
            limit: config.rateLimit.ipLimit,
            remaining: ipBucket.tokens,
            reset: resetTime,
            period: config.rateLimit.ipPeriod,
          },
          fingerprint: fingerprintBucket
            ? {
                limit: config.rateLimit.limit,
                remaining: fingerprintBucket.tokens,
                reset: resetTime,
                period: config.rateLimit.period,
              }
            : null,
          combined: {
            limit: Math.min(config.rateLimit.ipLimit, config.rateLimit.limit || Infinity),
            remaining: Math.min(
              ipBucket.tokens,
              fingerprintBucket ? fingerprintBucket.tokens : Infinity
            ),
            reset: resetTime,
            period: Math.max(config.rateLimit.ipPeriod, config.rateLimit.period || 0),
          },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    } catch (error) {
      console.error('RateLimiter: Unexpected error in getRateLimitInfo:', error);
      return new Response(JSON.stringify({ error: 'Unexpected error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  async getBucket(key, limit, now) {
    let bucket = await this.state.storage.get(key);
    if (!bucket) {
      console.log(`RateLimiter: Creating new bucket for key ${key}`);
      bucket = { tokens: limit, lastRefill: now };
    }
    return bucket;
  }

  refillBucket(bucket, limit, period, now) {
    const elapsed = Math.max(0, now - bucket.lastRefill);
    const rate = limit / period;
    bucket.tokens = Math.min(limit, bucket.tokens + elapsed * rate);
    bucket.lastRefill = now;
    console.log(`RateLimiter: Refilled bucket, new token count: ${bucket.tokens}`);
    return bucket;
  }
}
