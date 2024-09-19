import { generateFingerprint } from './fingerprint.js';
import { evaluateConditions } from './condition-evaluator.js';

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

      const clientIdentifier = await this.getClientIdentifier(request, rule, cf);

      const matches = await evaluateConditions(
        request,
        rule.initialMatch.conditions,
        rule.initialMatch.logic
      );
      if (!matches) {
        console.log('Request does not match initial conditions, allowing');
        return this.createResponse(
          true,
          rule,
          rule.rateLimit.limit,
          now + rule.rateLimit.period * 1000,
          0,
          clientIdentifier
        );
      }

      const { isAllowed, remaining, resetTime } = await this.checkRateLimit(
        clientIdentifier,
        rule,
        now
      );

      console.log(
        `RateLimiter: Request ${isAllowed ? 'allowed' : 'denied'} for ${clientIdentifier}`
      );

      const retryAfter = Math.max(0, (resetTime - now) / 1000);

      return this.createResponse(
        isAllowed,
        rule,
        remaining,
        resetTime,
        retryAfter,
        clientIdentifier
      );
    } catch (error) {
      console.error('RateLimiter: Unexpected error:', error);
      return this.errorResponse('Unexpected error', 500);
    }
  }

  async checkRateLimit(clientIdentifier, rule, now) {
    const windowSize = rule.rateLimit.period * 1000;
    const limit = rule.rateLimit.limit;

    let data = await this.state.storage.get(clientIdentifier);
    let timestamps = data ? JSON.parse(data) : [];

    // Remove timestamps outside the current window
    const windowStart = now - windowSize;
    timestamps = timestamps.filter((ts) => ts >= windowStart);

    const isAllowed = timestamps.length < limit;
    if (isAllowed) {
      timestamps.push(now);
    }

    // Keep only the most recent 'limit' timestamps
    if (timestamps.length > limit) {
      timestamps = timestamps.slice(-limit);
    }

    await this.state.storage.put(clientIdentifier, JSON.stringify(timestamps));

    const oldestTimestamp = timestamps[0] || now;
    const resetTime = Math.max(oldestTimestamp + windowSize, now + 1000);

    return {
      isAllowed,
      remaining: Math.max(0, limit - timestamps.length),
      resetTime,
    };
  }

  parseRule(request) {
    try {
      const rule = JSON.parse(request.headers.get('X-Rate-Limit-Config'));
      if (rule?.name && rule.rateLimit?.limit && rule.rateLimit?.period && rule.action?.type) {
        console.log('RateLimiter: Parsed rule:', JSON.stringify(rule, null, 2));
        return rule;
      }
      console.error('RateLimiter: Invalid rule structure:', JSON.stringify(rule, null, 2));
      return null;
    } catch (error) {
      console.error('RateLimiter: Error parsing rule:', error);
      return null;
    }
  }

  async getClientIdentifier(request, rule, cfData) {
    if (rule.fingerprint?.parameters) {
      const fingerprint = await generateFingerprint(request, this.env, rule.fingerprint, cfData);
      return `rate_limit:${rule.name}:fingerprint:${fingerprint}`;
    }
    const clientIp = cfData.clientIp || request.headers.get('CF-Connecting-IP') || 'unknown';
    return `rate_limit:${rule.name}:ip:${clientIp}`;
  }

  createResponse(isAllowed, rule, remaining, resetTime, retryAfter, clientIdentifier) {
    const headers = new Headers({
      'Content-Type': 'application/json',
      'X-Rate-Limit-Limit': rule.rateLimit.limit.toString(),
      'X-Rate-Limit-Remaining': remaining.toString(),
      'X-Rate-Limit-Reset': Math.floor(resetTime / 1000).toString(),
      'X-Rate-Limit-Reset-Precise': (resetTime / 1000).toFixed(3),
      'X-Rate-Limit-Period': rule.rateLimit.period.toString(),
      'X-Client-Identifier': clientIdentifier,
    });

    const responseBody = {
      allowed: isAllowed,
      limit: rule.rateLimit.limit,
      remaining,
      reset: Math.floor(resetTime / 1000),
      resetFormatted: new Date(resetTime).toUTCString(),
      period: rule.rateLimit.period,
      action: rule.action,
      clientIdentifier,
    };

    if (!isAllowed) {
      headers.set('Retry-After', retryAfter.toString());
      responseBody.retryAfter = parseFloat(retryAfter.toFixed(3));
    }

    console.log('Response headers:', Object.fromEntries(headers));
    console.log('Response body:', responseBody);

    return new Response(JSON.stringify(responseBody), {
      status: isAllowed ? 200 : 429,
      headers,
    });
  }

  errorResponse(message, status = 200) {
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  async getRateLimitInfo(request, rule) {
    try {
      const payload = await request.json();
      const { cf } = payload;
      const now = Date.now();
      const clientIdentifier = await this.getClientIdentifier(request, rule, cf);

      const { remaining, resetTime } = await this.checkRateLimit(clientIdentifier, rule, now);

      const responseBody = {
        limit: rule.rateLimit.limit,
        remaining,
        reset: Math.floor(resetTime / 1000),
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
