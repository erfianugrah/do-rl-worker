import { RateLimiter } from "./rate-limiter.js";
import { serveRateLimitInfoPage, serveRateLimitPage } from "./staticpages.js";
import { actionHandlers, findMatchingRule } from "./condition-evaluator.js";
import {
  applyRateLimitHeaders,
  handleRateLimit,
} from "./rate-limit-handler.js";
import { backgroundRefresh, getConfig } from "./config-manager.js";

export default {
  async fetch(request, env, ctx) {
    console.log("Received request for URL:", request.url);
    const url = new URL(request.url);

    if (url.pathname === "/config") {
      const configStorageId = env.CONFIG_STORAGE.idFromName("global");
      const configStorage = env.CONFIG_STORAGE.get(configStorageId);
      return configStorage.fetch(request);
    }

    if (request.headers.get("X-Serve-Rate-Limit-Page") === "true") {
      const rateLimitInfo = JSON.parse(
        request.headers.get("X-Rate-Limit-Info") || "{}",
      );
      return serveRateLimitPage(env, request, rateLimitInfo);
    }

    // Start background refresh if not already running
    ctx.waitUntil(backgroundRefresh(env));

    try {
      const config = await getConfig(env);

      if (!config || !config.rules || config.rules.length === 0) {
        console.log(
          "No rate limiting rules configured, passing through request",
        );
        return fetch(request);
      }

      const matchingRule = await findMatchingRule(request, config);

      if (!matchingRule) {
        console.log(
          "Request does not match any criteria, passing through to origin",
        );
        return fetch(request);
      }

      console.log("Request matches criteria for rule:", matchingRule.name);
      console.log("Action type:", matchingRule.actionType);

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

        if (matchingRule.actionType === "simulate") {
          response = new Response(response.body, response);
          response.headers.set("X-Rate-Limit-Simulated", "false");
        }
      } else {
        console.log(
          "Rate limit exceeded, applying action:",
          matchingRule.actionType,
        );
        response = await actionHandlers[matchingRule.actionType](
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
};

export { RateLimiter };
