import { RateLimiter } from "./rate-limiter.js";
import { serveRateLimitInfoPage, serveRateLimitPage } from "./staticpages.ts";
import { actionHandlers, findMatchingRule } from "./condition-evaluator.js";
import {
  applyRateLimitHeaders,
  handleRateLimit,
} from "./rate-limit-handler.js";
import { getConfig } from "./config-manager.js";

export default {
  async fetch(request, env, ctx) {
    console.log("Received request for URL:", request.url);
    const url = new URL(request.url);

    if (request.headers.get("X-Serve-Rate-Limit-Page") === "true") {
      const rateLimitInfo = JSON.parse(
        request.headers.get("X-Rate-Limit-Info") || "{}",
      );
      return serveRateLimitPage(env, request, rateLimitInfo);
    }

    try {
      const config = await getConfig(env);

      if (!config || config.length === 0) {
        console.log(
          "No rate limiting rules configured, passing through request",
        );
        return fetch(request);
      }

      console.log(`Loaded ${config.length} rate limiting rules`);

      const matchingRule = await findMatchingRule(request, config);

      if (!matchingRule) {
        console.log(
          "Request does not match any criteria, passing through to origin",
        );
        return fetch(request);
      }

      console.log("Request matches criteria for rule:", matchingRule.name);
      console.log("Action type:", matchingRule.initialMatch.action.type);

      if (url.pathname === env.RATE_LIMIT_INFO_PATH) {
        console.log("Serving rate limit info page");
        const { rateLimitInfo } = await handleRateLimit(
          request,
          env,
          matchingRule,
        );
        return serveRateLimitInfoPage(env, request, rateLimitInfo);
      }

      const { rateLimitInfo, rateLimitResponse } = await handleRateLimit(
        request,
        env,
        matchingRule,
      );

      let response;
      if (rateLimitInfo.allowed) {
        console.log("Rate limit not exceeded, forwarding request");
        response = await fetch(request);

        if (matchingRule.initialMatch.action.type === "simulate") {
          response = new Response(response.body, response);
          response.headers.set("X-Rate-Limit-Simulated", "false");
        }
      } else {
        console.log(
          "Rate limit exceeded, applying action:",
          matchingRule.initialMatch.action.type,
        );
        response = await actionHandlers[matchingRule.initialMatch.action.type](
          env,
          request,
          rateLimitInfo,
          matchingRule,
        );
      }

      return applyRateLimitHeaders(response, rateLimitResponse);
    } catch (error) {
      console.error("Error in rate limiting:", error);
      return fetch(request); // Pass through on error
    }
  },

  async queue(batch, env, ctx) {
    console.log(`Received ${batch.messages.length} messages from the queue`);
    for (const message of batch.messages) {
      try {
        if (message.body && message.body.type === "config_update") {
          console.log("Received config update notification");
          await getConfig(env);
          await message.ack();
        } else {
          console.log("Received unexpected message type:", message.body?.type);
          await message.ack();
        }
      } catch (error) {
        console.error("Error processing queue message:", error);
      }
    }
  },
};

export { RateLimiter };
