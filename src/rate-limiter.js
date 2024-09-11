import { generateFingerprint } from './fingerprint.js';
import { evaluateCondition } from './condition-evaluator.js';

class BucketOperations {
  constructor(storage) {
    this.storage = storage;
  }

  async getBucket(key, limit, now) {
    let bucket = await this.storage.get(key);
    if (!bucket) {
      console.log(`BucketOperations: Creating new bucket for key ${key}`);
      bucket = { key, tokens: limit, lastRefill: now };
    } else {
      console.log(
        `BucketOperations: Retrieved existing bucket for key ${key}:`,
        JSON.stringify(bucket, null, 2)
      );
    }
    return bucket;
  }

  refillBucket(bucket, limit, period, now) {
    const elapsed = Math.max(0, now - bucket.lastRefill);
    const rate = limit / period;
    const oldTokens = bucket.tokens;
    bucket.tokens = Math.min(limit, bucket.tokens + elapsed * rate);
    bucket.lastRefill = now;
    console.log(
      `BucketOperations: Refilled bucket, old token count: ${oldTokens}, new token count: ${bucket.tokens}`
    );
    return bucket;
  }
}

export class RateLimiter {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.bucketOps = new BucketOperations(state.storage);
  }

  async fetch(request) {
    console.log('RateLimiter: Received request for URL:', request.url);

    const requestHeaders = Object.fromEntries(request.headers);
    console.log('RateLimiter: All request headers:', JSON.stringify(requestHeaders, null, 2));

    let rule, clientIdentifier, now, bucket;

    try {
      rule = JSON.parse(request.headers.get('X-Rate-Limit-Config'));
      console.log('RateLimiter: Parsed rule:', JSON.stringify(rule, null, 2));

      const originalCfData = JSON.parse(request.headers.get('X-Original-CF-Data') || '{}');
      console.log('RateLimiter: Original CF data:', JSON.stringify(originalCfData, null, 2));

      rule.rateLimit.limit = Number(rule.rateLimit.limit);
      rule.rateLimit.period = Number(rule.rateLimit.period);

      now = Math.floor(Date.now() / 1000);

      if (rule.fingerprint && rule.fingerprint.parameters) {
        console.log(
          'RateLimiter: Generating fingerprint with parameters:',
          rule.fingerprint.parameters
        );
        clientIdentifier = await generateFingerprint(
          request,
          this.env,
          rule.fingerprint,
          originalCfData
        );
      } else {
        clientIdentifier = this.getClientIP(request);
      }
      console.log('RateLimiter: Client identifier:', clientIdentifier);

      const bucketKey = `rate_limit:${rule.name}:${clientIdentifier}`;
      bucket = await this.bucketOps.getBucket(bucketKey, rule.rateLimit.limit, now);
      bucket = this.bucketOps.refillBucket(
        bucket,
        rule.rateLimit.limit,
        rule.rateLimit.period,
        now
      );

      console.log('RateLimiter: Bucket after refill:', JSON.stringify(bucket, null, 2));

      const isAllowed = bucket.tokens >= 1;

      if (isAllowed) {
        console.log('RateLimiter: Request allowed, tokens remaining:', bucket.tokens);
        bucket.tokens -= 1;
        await this.state.storage.put(bucket.key, bucket);
      } else {
        console.log('RateLimiter: Request denied, tokens remaining:', bucket.tokens);
      }

      const resetTime = Math.ceil(
        now +
          (rule.rateLimit.limit - bucket.tokens) / (rule.rateLimit.limit / rule.rateLimit.period)
      );

      const retryAfter = Math.max(0, resetTime - now);

      const responseBody = JSON.stringify({
        allowed: isAllowed,
        remaining: bucket.tokens,
        limit: rule.rateLimit.limit,
        period: rule.rateLimit.period,
        reset: resetTime,
        retryAfter: retryAfter,
        clientIdentifier: clientIdentifier,
        botScore: originalCfData.botManagement?.score,
      });

      console.log('RateLimiter: Response body:', responseBody);

      return new Response(responseBody, {
        status: isAllowed ? 200 : 429,
        headers: {
          'Content-Type': 'application/json',
          'X-Rate-Limit-Remaining': bucket.tokens.toFixed(6),
          'X-Rate-Limit-Limit': rule.rateLimit.limit.toString(),
          'X-Rate-Limit-Period': rule.rateLimit.period.toString(),
          'X-Rate-Limit-Reset': resetTime.toString(),
          'X-Rate-Limit-Retry-After': retryAfter.toString(),
          'X-Client-Identifier': clientIdentifier,
        },
      });
    } catch (error) {
      console.error('RateLimiter: Unexpected error:', error);
      return new Response(
        JSON.stringify({
          error: 'Unexpected error',
          details: error.message,
          stack: error.stack,
        }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }
  }
  getClientIP(request) {
    return (
      request.headers.get('CF-Connecting-IP') ||
      request.headers.get('True-Client-IP') ||
      request.headers.get('X-Forwarded-For')?.split(',')[0].trim() ||
      'unknown'
    );
  }
}
