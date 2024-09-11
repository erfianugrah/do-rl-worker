import { generateFingerprint } from './fingerprint.js';

class SlidingWindowRateLimiter {
  constructor(limit, windowSize) {
    this.limit = limit;
    this.windowSize = windowSize; // in milliseconds
    this.requests = [];
  }

  allowRequest(now) {
    this.requests = this.requests.filter((req) => now - req < this.windowSize);
    if (this.requests.length < this.limit) {
      this.requests.push(now);
      return true;
    }
    return false;
  }

  getRemainingTokens(now) {
    this.requests = this.requests.filter((req) => now - req < this.windowSize);
    return Math.max(0, this.limit - this.requests.length);
  }

  getResetTime(now) {
    if (this.requests.length === 0) return now + this.windowSize;
    const oldestRequest = Math.min(...this.requests);
    return oldestRequest + this.windowSize;
  }
}

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
      const { cf } = payload;

      const now = Date.now();
      console.log(`Current time (now): ${now}`);

      const { limiter, clientIdentifier } = await this.getLimiterAndIdentifier(
        request,
        rule,
        now,
        cf
      );

      const isAllowed = limiter.allowRequest(now);
      console.log(
        `RateLimiter: Request ${isAllowed ? 'allowed' : 'denied'} for ${clientIdentifier}`
      );

      const remainingTokens = limiter.getRemainingTokens(now);
      const resetTime = limiter.getResetTime(now);
      console.log(`Reset time (milliseconds): ${resetTime}`);

      const retryAfter = Math.max(0, (resetTime - now) / 1000).toFixed(3);

      // Store the updated limiter state
      await this.state.storage.put(clientIdentifier, JSON.stringify(limiter));

      return this.createResponse(
        isAllowed,
        rule,
        remainingTokens,
        resetTime,
        retryAfter,
        clientIdentifier
      );
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

  async getLimiterAndIdentifier(request, rule, now, cfData) {
    let clientIdentifier;

    if (rule.fingerprint?.parameters) {
      clientIdentifier = await generateFingerprint(request, this.env, rule.fingerprint, cfData);
      clientIdentifier = `rate_limit:${rule.name}:fingerprint:${clientIdentifier}`;
    } else {
      clientIdentifier = cfData.clientIp || request.headers.get('CF-Connecting-IP') || 'unknown';
      clientIdentifier = `rate_limit:${rule.name}:ip:${clientIdentifier}`;
    }

    let limiterData = await this.state.storage.get(clientIdentifier);
    let limiter;

    if (limiterData) {
      limiter = Object.assign(
        new SlidingWindowRateLimiter(rule.rateLimit.limit, rule.rateLimit.period * 1000),
        JSON.parse(limiterData)
      );
      limiter.requests = limiter.requests.filter((req) => now - req < limiter.windowSize);
    } else {
      limiter = new SlidingWindowRateLimiter(rule.rateLimit.limit, rule.rateLimit.period * 1000);
    }

    return { limiter, clientIdentifier };
  }

  createResponse(isAllowed, rule, remainingTokens, resetTime, retryAfter, clientIdentifier) {
    const resetTimeSeconds = Math.floor(resetTime / 1000);
    console.log(`Reset time (seconds): ${resetTimeSeconds}`);

    const headers = {
      'Content-Type': 'application/json',
      'X-Rate-Limit-Limit': rule.rateLimit.limit.toString(),
      'X-Rate-Limit-Remaining': remainingTokens.toFixed(3),
      'X-Rate-Limit-Reset': resetTimeSeconds.toString(),
      'X-Rate-Limit-Reset-Precise': (resetTime / 1000).toFixed(3),
      'X-Rate-Limit-Period': rule.rateLimit.period.toString(),
      'X-Client-Identifier': clientIdentifier,
    };

    const responseBody = {
      allowed: isAllowed,
      limit: rule.rateLimit.limit,
      remaining: parseFloat(remainingTokens.toFixed(3)),
      reset: resetTimeSeconds,
      resetFormatted: new Date(resetTime).toUTCString(),
      period: rule.rateLimit.period,
      action: rule.action,
      clientIdentifier: clientIdentifier,
    };

    if (!isAllowed) {
      headers['Retry-After'] = retryAfter;
      responseBody.retryAfter = parseFloat(retryAfter);
    }

    console.log('Response headers:', headers);
    console.log('Response body:', responseBody);

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
      const now = Date.now();
      const { limiter, clientIdentifier } = await this.getLimiterAndIdentifier(
        request,
        rule,
        now,
        cf
      );

      const remainingTokens = limiter.getRemainingTokens(now);
      const resetTime = limiter.getResetTime(now);
      const resetTimeSeconds = Math.floor(resetTime / 1000);

      const responseBody = {
        limit: rule.rateLimit.limit,
        remaining: parseFloat(remainingTokens.toFixed(3)),
        reset: resetTimeSeconds,
        resetFormatted: new Date(resetTime).toUTCString(),
        period: rule.rateLimit.period,
      };

      console.log('Rate limit info:', responseBody);

      return new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      console.error('RateLimiter: Unexpected error in getRateLimitInfo:', error);
      return this.errorResponse('Unexpected error', 500);
    }
  }
}
