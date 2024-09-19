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

      // Evaluate initial match
      const initialMatches = await evaluateConditions(
        request,
        rule.initialMatch.conditions,
        rule.initialMatch.logic || 'and'
      );

      if (initialMatches) {
        console.log('Initial match conditions met, applying rate limit');
        const { isAllowed, remaining, resetTime } = await this.checkRateLimit(
          clientIdentifier,
          rule,
          now
        );
        return this.createResponse(
          isAllowed,
          rule,
          remaining,
          resetTime,
          Math.max(0, (resetTime - now) / 1000),
          clientIdentifier,
          rule.initialMatch.action
        );
      }

      // Else action
      if (rule.elseAction) {
        return this.createResponse(
          true,
          rule,
          rule.rateLimit.limit,
          now + rule.rateLimit.period * 1000,
          0,
          clientIdentifier,
          rule.elseAction
        );
      }

      // If no conditions match and no else action, allow the request
      return this.createResponse(
        true,
        rule,
        rule.rateLimit.limit,
        now + rule.rateLimit.period * 1000,
        0,
        clientIdentifier,
        { type: 'allow' }
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
      if (
        rule?.name &&
        rule.rateLimit?.limit &&
        rule.rateLimit?.period &&
        rule.initialMatch?.action?.type
      ) {
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
      const fingerprintComponents = [];
      for (const param of rule.fingerprint.parameters) {
        let value;
        if (param.name.startsWith('headers.')) {
          const headerName = param.name.slice(8);
          value = request.headers.get(headerName);
        } else if (param.name.startsWith('url.')) {
          const url = new URL(request.url);
          value = url[param.name.slice(4)];
        } else if (param.name.startsWith('cf.')) {
          value = this.getNestedValue(cfData, param.name.slice(3));
        } else if (param.name === 'clientIP') {
          value = this.getClientIP(request, cfData);
        } else if (param.name === 'method') {
          value = request.method;
        } else if (param.name === 'url') {
          value = request.url;
        } else if (param.name === 'body' || param.name.startsWith('body.')) {
          // Implement body extraction logic here
          console.warn('Body fingerprinting not implemented');
          continue;
        } else {
          console.warn(`Unsupported fingerprint parameter: ${param.name}`);
          continue;
        }

        if (value) {
          fingerprintComponents.push(`${param.name}:${value}`);
        }
      }
      if (fingerprintComponents.length > 0) {
        const fingerprint = await generateFingerprint(
          request,
          this.env,
          { parameters: fingerprintComponents },
          cfData
        );
        return `rate_limit:${rule.name}:fingerprint:${fingerprint}`;
      }
    }
    return `rate_limit:${rule.name}:ip:${this.getClientIP(request, cfData)}`;
  }

  createResponse(isAllowed, rule, remaining, resetTime, retryAfter, clientIdentifier, action) {
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
      action: action,
      clientIdentifier,
    };

    if (!isAllowed) {
      headers.set('Retry-After', retryAfter.toString());
      responseBody.retryAfter = parseFloat(retryAfter.toFixed(3));
    }

    console.log('Response headers:', Object.fromEntries(headers));
    console.log('Response body:', responseBody);

    let status = isAllowed ? 200 : 429;
    if (action.type === 'customResponse') {
      status = action.statusCode || status;
    }

    return new Response(JSON.stringify(responseBody), {
      status: status,
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

  getClientIP(request, cfData) {
    return (
      request.headers.get('true-client-ip') ||
      request.headers.get('cf-connecting-ip') ||
      request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
      cfData.clientIp ||
      'unknown'
    );
  }

  getNestedValue(obj, path) {
    return path.split('.').reduce((current, part) => current && current[part], obj);
  }
}
