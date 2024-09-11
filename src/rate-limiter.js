import { generateFingerprint } from './fingerprint.js';

export class RateLimiter {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    console.log('RateLimiter: Received request');
    let rule;
    try {
      rule = JSON.parse(request.headers.get('X-Rate-Limit-Config'));
      console.log('RateLimiter: Parsed rule:', JSON.stringify(rule, null, 2));
    } catch (error) {
      console.error('RateLimiter: Error parsing rule:', error);
      return new Response(JSON.stringify({ error: 'Rule parsing error' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    console.log('RateLimiter: Received rule:', JSON.stringify(rule, null, 2));

    if (!rule || !rule.rateLimit || !rule.rateLimit.limit) {
      console.error('RateLimiter: Invalid or missing rule');
      return new Response(JSON.stringify({ error: 'Invalid or missing rule' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Check if this is a rate limit info request
    if (request.url.endsWith('/_ratelimit')) {
      return this.getRateLimitInfo(request, rule);
    }

    try {
      const now = Math.floor(Date.now() / 1000);

      let bucket;
      let clientIdentifier;

      // Parse CF data from header
      const cfData = JSON.parse(request.headers.get('X-CF-Data') || '{}');
      console.log('RateLimiter: Parsed CF data:', JSON.stringify(cfData, null, 2));

      // Log all headers for debugging
      console.log('RateLimiter: All request headers:', Object.fromEntries([...request.headers]));

      if (rule.fingerprint && rule.fingerprint.parameters) {
        console.log('RateLimiter: Generating fingerprint');
        const fingerprint = await generateFingerprint(request, this.env, rule.fingerprint, cfData);
        console.log('RateLimiter: Generated fingerprint:', fingerprint);
        clientIdentifier = fingerprint;
        const fingerprintKey = `rate_limit:${rule.name}:fingerprint:${fingerprint}`;
        bucket = await this.getBucket(fingerprintKey, rule.rateLimit.limit, now);
      } else {
        const ip =
          request.headers.get('CF-Connecting-IP') ||
          request.headers.get('X-Forwarded-For') ||
          request.headers.get('True-Client-IP') ||
          'unknown';
        console.log('RateLimiter: Client IP:', ip);
        clientIdentifier = ip;
        const ipKey = `rate_limit:${rule.name}:ip:${ip}`;
        bucket = await this.getBucket(ipKey, rule.rateLimit.limit, now);
      }

      bucket = this.refillBucket(bucket, rule.rateLimit.limit, rule.rateLimit.period, now);

      console.log('RateLimiter: Bucket:', JSON.stringify(bucket, null, 2));

      const isAllowed = bucket.tokens >= 1;

      if (isAllowed) {
        console.log('RateLimiter: Request allowed, tokens before decrement:', bucket.tokens);
        bucket.tokens -= 1;
        console.log('RateLimiter: Tokens after decrement:', bucket.tokens);
        await this.state.storage.put(bucket.key, bucket);
        console.log('RateLimiter: Updated bucket in storage');

        const resetTime = Math.ceil(
          now + (1 - bucket.tokens) / (rule.rateLimit.limit / rule.rateLimit.period)
        );

        return new Response(
          JSON.stringify({
            allowed: true,
            remaining: bucket.tokens,
            limit: rule.rateLimit.limit,
            period: rule.rateLimit.period,
            reset: resetTime,
            action: rule.action,
            clientIdentifier: clientIdentifier,
          }),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
              'X-Rate-Limit-Remaining': bucket.tokens.toFixed(6),
              'X-Rate-Limit-Limit': rule.rateLimit.limit.toString(),
              'X-Rate-Limit-Period': rule.rateLimit.period.toString(),
              'X-Rate-Limit-Reset': resetTime.toString(),
              'X-Client-Identifier': clientIdentifier,
            },
          }
        );
      } else {
        console.log('RateLimiter: Rate limit exceeded, current tokens:', bucket.tokens);
        const retryAfter = (
          (1 - bucket.tokens) /
          (rule.rateLimit.limit / rule.rateLimit.period)
        ).toFixed(3);

        return new Response(
          JSON.stringify({
            allowed: false,
            retryAfter: parseFloat(retryAfter),
            limit: rule.rateLimit.limit,
            period: rule.rateLimit.period,
            reset: Math.ceil(now + parseFloat(retryAfter)),
            action: rule.action,
            clientIdentifier: clientIdentifier,
          }),
          {
            status: 429,
            headers: {
              'Content-Type': 'application/json',
              'Retry-After': retryAfter,
              'X-Rate-Limit-Limit': rule.rateLimit.limit.toString(),
              'X-Rate-Limit-Period': rule.rateLimit.period.toString(),
              'X-Rate-Limit-Reset': Math.ceil(now + parseFloat(retryAfter)).toString(),
              'X-Client-Identifier': clientIdentifier,
            },
          }
        );
      }
    } catch (error) {
      console.error('RateLimiter: Unexpected error:', error);
      return new Response(JSON.stringify({ error: 'Unexpected error', details: error.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  async getRateLimitInfo(request, rule) {
    console.log('RateLimiter: Getting rate limit info');

    try {
      const now = Math.floor(Date.now() / 1000);

      let bucket;
      if (rule.fingerprint && rule.fingerprint.parameters) {
        console.log('RateLimiter: Generating fingerprint for info');
        const fingerprint = await generateFingerprint(request, this.env, rule.fingerprint);
        console.log('RateLimiter: Generated fingerprint for info:', fingerprint);
        const fingerprintKey = `rate_limit:${rule.name}:fingerprint:${fingerprint}`;
        bucket = await this.getBucket(fingerprintKey, rule.rateLimit.limit, now);
      } else {
        const ip = request.headers.get('CF-Connecting-IP');
        console.log('RateLimiter: Client IP for info:', ip);
        const ipKey = `rate_limit:${rule.name}:ip:${ip}`;
        bucket = await this.getBucket(ipKey, rule.rateLimit.limit, now);
      }

      bucket = this.refillBucket(bucket, rule.rateLimit.limit, rule.rateLimit.period, now);

      console.log('RateLimiter: Bucket for info:', JSON.stringify(bucket, null, 2));

      const resetTime = Math.ceil(
        now +
          (rule.rateLimit.limit - bucket.tokens) / (rule.rateLimit.limit / rule.rateLimit.period)
      );

      return new Response(
        JSON.stringify({
          limit: rule.rateLimit.limit,
          remaining: bucket.tokens,
          reset: resetTime,
          period: rule.rateLimit.period,
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
      bucket = { key, tokens: limit, lastRefill: now };
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
