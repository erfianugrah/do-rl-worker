import { generateFingerprint } from './fingerprint.js';

export class RateLimiter {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    console.log('RateLimiter: Received request');
    const rule = this.parseRule(request);
    if (!rule) {
      return this.errorResponse('Invalid or missing rule');
    }

    if (request.url.endsWith('/_ratelimit')) {
      return this.getRateLimitInfo(request, rule);
    }

    try {
      const payload = await request.json();
      const { cf, originalUrl, method } = payload;

      const now = Math.floor(Date.now() / 1000);
      const { bucket, clientIdentifier } = await this.getBucketAndIdentifier(
        request,
        rule,
        now,
        cf
      );

      const isAllowed = bucket.tokens >= 1;
      console.log(
        `RateLimiter: Request ${isAllowed ? 'allowed' : 'denied'} for ${clientIdentifier}`
      );

      if (isAllowed) {
        bucket.tokens -= 1;
        await this.state.storage.put(bucket.key, bucket);
      }

      const resetTime = Math.ceil(
        now + (1 - bucket.tokens) / (rule.rateLimit.limit / rule.rateLimit.period)
      );
      const retryAfter = (
        (1 - bucket.tokens) /
        (rule.rateLimit.limit / rule.rateLimit.period)
      ).toFixed(3);

      return this.createResponse(isAllowed, bucket, rule, resetTime, retryAfter, clientIdentifier);
    } catch (error) {
      console.error('RateLimiter: Unexpected error:', error);
      return this.errorResponse('Unexpected error', 500);
    }
  }

  parseRule(request) {
    try {
      const rule = JSON.parse(request.headers.get('X-Rate-Limit-Config'));
      console.log('RateLimiter: Parsed rule:', JSON.stringify(rule, null, 2));
      return rule?.rateLimit?.limit ? rule : null;
    } catch (error) {
      console.error('RateLimiter: Error parsing rule:', error);
      return null;
    }
  }

  async getBucketAndIdentifier(request, rule, now, cfData) {
    let clientIdentifier, bucketKey;

    if (rule.fingerprint?.parameters) {
      clientIdentifier = await generateFingerprint(request, this.env, rule.fingerprint, cfData);
      bucketKey = `rate_limit:${rule.name}:fingerprint:${clientIdentifier}`;
    } else {
      clientIdentifier = cfData.clientIp || request.headers.get('CF-Connecting-IP') || 'unknown';
      bucketKey = `rate_limit:${rule.name}:ip:${clientIdentifier}`;
    }

    let bucket = await this.state.storage.get(bucketKey);
    if (!bucket) {
      bucket = { key: bucketKey, tokens: rule.rateLimit.limit, lastRefill: now };
    }

    bucket = this.refillBucket(bucket, rule.rateLimit.limit, rule.rateLimit.period, now);
    return { bucket, clientIdentifier };
  }

  refillBucket(bucket, limit, period, now) {
    if (period <= 0) {
      console.error('RateLimiter: Invalid period', period);
      return bucket;
    }
    const elapsed = Math.max(0, now - bucket.lastRefill);
    const rate = limit / period;
    bucket.tokens = Math.min(limit, bucket.tokens + elapsed * rate);
    bucket.lastRefill = now;
    return bucket;
  }

  createResponse(isAllowed, bucket, rule, resetTime, retryAfter, clientIdentifier) {
    const headers = {
      'Content-Type': 'application/json',
      'X-Rate-Limit-Limit': rule.rateLimit.limit.toString(),
      'X-Rate-Limit-Period': rule.rateLimit.period.toString(),
      'X-Rate-Limit-Reset': resetTime.toString(),
      'X-Client-Identifier': clientIdentifier,
    };

    const responseBody = {
      allowed: isAllowed,
      limit: rule.rateLimit.limit,
      period: rule.rateLimit.period,
      reset: resetTime,
      action: rule.action,
      clientIdentifier: clientIdentifier,
    };

    if (isAllowed) {
      const remainingTokens = Math.max(0, bucket.tokens - 1); // Subtract 1 to account for current request
      headers['X-Rate-Limit-Remaining'] = remainingTokens.toFixed(6);
      responseBody.remaining = Number(remainingTokens.toFixed(6)); // Round to 6 decimal places
    } else {
      headers['Retry-After'] = retryAfter;
      responseBody.retryAfter = parseFloat(retryAfter);
    }

    return new Response(JSON.stringify(responseBody), {
      status: isAllowed ? 200 : 429,
      headers: headers,
    });
  }

  errorResponse(message, status = 200) {
    return new Response(JSON.stringify({ error: message }), {
      status: status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  async getRateLimitInfo(request, rule) {
    try {
      const payload = await request.json();
      const { cf } = payload;
      const now = Math.floor(Date.now() / 1000);
      const { bucket } = await this.getBucketAndIdentifier(request, rule, now, cf);

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
      return this.errorResponse('Unexpected error', 500);
    }
  }
}
