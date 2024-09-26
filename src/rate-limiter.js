import { generateFingerprint } from "./fingerprint.js";
import { evaluateConditions } from "./condition-evaluator.js";

const DEFAULT_STATUS_CODE = 200;
const RATE_LIMIT_EXCEEDED_STATUS = 429;
const STORAGE_PREFIX = "rate_limit:";

export class RateLimiter {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    const fetchStartTime = Date.now();
    console.log("RateLimiter: Received request");
    const rule = this.parseRule(request);
    if (!rule) {
      return this.errorResponse("Invalid or missing rule");
    }

    if (request.url.endsWith("/_ratelimit")) {
      return this.getRateLimitInfo(request, rule);
    }

    try {
      const payload = await request.json();
      const { cf } = payload;

      const now = Date.now();
      console.log(`Current time (now): ${now}`);

      console.log(`Rule matched: ${JSON.stringify(rule)}`);
      console.log(`Fingerprint config: ${JSON.stringify(rule.fingerprint)}`);
      console.log(
        `Request headers: ${
          JSON.stringify(Object.fromEntries(request.headers))
        }`,
      );

      const clientIdentifier = await this.getClientIdentifier(request, rule, cf)
        .catch((error) => {
          console.error(`Failed to get client identifier: ${error.message}`);
          throw new Error("Failed to identify client");
        });

      console.log(
        `RateLimiter: Processing request for client identifier: ${clientIdentifier}`,
      );

      const initialMatches = await evaluateConditions(
        request,
        rule.initialMatch.conditions,
        rule.initialMatch.logic || "and",
      );

      if (initialMatches) {
        console.log("Initial match conditions met, applying rate limit");
        const { isAllowed, remaining, resetTime } = await this.checkRateLimit(
          clientIdentifier,
          rule,
          now,
        );
        return this.createResponse(
          isAllowed,
          rule,
          remaining,
          resetTime,
          Math.max(0, (resetTime - now) / 1000),
          clientIdentifier,
          rule.initialMatch.action,
        );
      }

      const action = rule.elseAction || { type: "allow" };
      return this.createResponse(
        true,
        rule,
        rule.rateLimit.limit,
        now + rule.rateLimit.period * 1000,
        0,
        clientIdentifier,
        action,
      );
    } catch (error) {
      console.error("RateLimiter: Unexpected error:", error);
      return new Response(
        JSON.stringify({
          error: "Unexpected error",
          message: error.message,
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        },
      );
    } finally {
      console.log(
        `RateLimiter: Total fetch processing time: ${
          Date.now() - fetchStartTime
        }ms`,
      );
    }
  }

  async checkRateLimit(clientIdentifier, rule, now) {
    const startTime = Date.now();
    const windowSize = rule.rateLimit.period * 1000;
    const limit = rule.rateLimit.limit;

    let data = await this.state.storage.get(clientIdentifier);
    console.log(`Storage get took ${Date.now() - startTime}ms`);

    let timestamps = data ? JSON.parse(data) : [];
    const windowStart = now - windowSize;

    const filterStart = Date.now();
    timestamps = timestamps.filter((ts) => ts >= windowStart);
    console.log(`Timestamp filtering took ${Date.now() - filterStart}ms`);

    const isAllowed = timestamps.length < limit;
    if (isAllowed) {
      timestamps.push(now);
    }

    timestamps = timestamps.slice(-limit);

    const storageStart = Date.now();
    await this.state.storage.put(clientIdentifier, JSON.stringify(timestamps));
    console.log(`Storage put took ${Date.now() - storageStart}ms`);

    const oldestTimestamp = timestamps[0] || now;
    const resetTime = Math.max(oldestTimestamp + windowSize, now + 1000);

    const totalTime = Date.now() - startTime;
    console.log(`Total checkRateLimit time: ${totalTime}ms`);

    return {
      isAllowed,
      remaining: Math.max(0, limit - timestamps.length),
      resetTime,
    };
  }

  parseRule(request) {
    try {
      const rule = JSON.parse(request.headers.get("X-Rate-Limit-Config"));
      const isValidRule = rule?.name &&
        rule.rateLimit?.limit &&
        rule.rateLimit?.period &&
        rule.initialMatch?.action?.type;

      if (isValidRule) {
        console.log("RateLimiter: Parsed rule:", JSON.stringify(rule, null, 2));
        return rule;
      }
      console.error(
        "RateLimiter: Invalid rule structure:",
        JSON.stringify(rule, null, 2),
      );
      return null;
    } catch (error) {
      console.error("RateLimiter: Error parsing rule:", error);
      return null;
    }
  }

  async getClientIdentifier(request, rule, cfData) {
    if (
      !rule.fingerprint?.parameters || rule.fingerprint.parameters.length === 0
    ) {
      console.log(`No fingerprint configured for rule: ${rule.name}`);
      return `${STORAGE_PREFIX}${rule.name}:default`;
    }

    try {
      const fingerprint = await generateFingerprint(
        request,
        this.env,
        rule.fingerprint,
        cfData,
      );
      console.log(
        `Generated fingerprint for rule ${rule.name}: ${fingerprint}`,
      );
      return `${STORAGE_PREFIX}${rule.name}:fingerprint:${fingerprint}`;
    } catch (error) {
      console.error(
        `Error generating fingerprint for rule ${rule.name}: ${error.message}`,
      );
      throw new Error(`Failed to generate fingerprint for rule ${rule.name}`);
    }
  }

  createResponse(
    isAllowed,
    rule,
    remaining,
    resetTime,
    retryAfter,
    clientIdentifier,
    action,
  ) {
    const headers = new Headers({
      "Content-Type": "application/json",
      "X-Rate-Limit-Limit": rule.rateLimit.limit.toString(),
      "X-Rate-Limit-Remaining": remaining.toString(),
      "X-Rate-Limit-Reset": Math.floor(resetTime / 1000).toString(),
      "X-Rate-Limit-Reset-Precise": (resetTime / 1000).toFixed(3),
      "X-Rate-Limit-Period": rule.rateLimit.period.toString(),
      "X-Client-Identifier": clientIdentifier,
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
      headers.set("Retry-After", retryAfter.toString());
      responseBody.retryAfter = parseFloat(retryAfter.toFixed(3));
    }

    console.log("Response headers:", Object.fromEntries(headers));
    console.log("Response body:", responseBody);

    const status = action.type === "customResponse"
      ? action.statusCode ||
        (isAllowed ? DEFAULT_STATUS_CODE : RATE_LIMIT_EXCEEDED_STATUS)
      : isAllowed
      ? DEFAULT_STATUS_CODE
      : RATE_LIMIT_EXCEEDED_STATUS;

    return new Response(JSON.stringify(responseBody), { status, headers });
  }

  errorResponse(message, status = DEFAULT_STATUS_CODE) {
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }

  async getRateLimitInfo(request, rule) {
    try {
      const payload = await request.json();
      const { cf } = payload;
      const now = Date.now();
      const clientIdentifier = await this.getClientIdentifier(
        request,
        rule,
        cf,
      );

      const { remaining, resetTime } = await this.checkRateLimit(
        clientIdentifier,
        rule,
        now,
      );

      const responseBody = {
        limit: rule.rateLimit.limit,
        remaining,
        reset: Math.floor(resetTime / 1000),
        resetFormatted: new Date(resetTime).toUTCString(),
        period: rule.rateLimit.period,
      };

      console.log("Rate limit info:", responseBody);

      return new Response(JSON.stringify(responseBody), {
        status: DEFAULT_STATUS_CODE,
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      console.error(
        "RateLimiter: Unexpected error in getRateLimitInfo:",
        error,
      );
      return this.errorResponse("Unexpected error", 500);
    }
  }
}
