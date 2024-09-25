import { RateLimiter } from "./rate-limiter.js";
import { ConfigStorage } from "./config-storage.js";
import { serveRateLimitInfoPage, serveRateLimitPage } from "./staticpages.js";
import { evaluateConditions } from "./condition-evaluator.js";

let cachedConfig = null;
let lastConfigFetch = 0;
const CONFIG_CACHE_TTL = 60 * 1000; // 1 minute

async function getConfig(env) {
  const now = Date.now();
  if (cachedConfig && now - lastConfigFetch < CONFIG_CACHE_TTL) {
    return cachedConfig;
  }

  try {
    const configStorageId = env.CONFIG_STORAGE.idFromName("global");
    const configStorage = env.CONFIG_STORAGE.get(configStorageId);
    const configResponse = await configStorage.fetch(
      new Request("https://rate-limiter-configurator/config"),
    );

    if (!configResponse.ok) {
      throw new Error(
        `Failed to fetch config: ${configResponse.status} ${configResponse.statusText}`,
      );
    }

    const config = await configResponse.json();
    console.log("Fetched config:", JSON.stringify(config, null, 2));

    if (!config || !Array.isArray(config.rules) || config.rules.length === 0) {
      console.warn("Config is empty or invalid");
      return null;
    }

    cachedConfig = config;
    lastConfigFetch = now;
    return cachedConfig;
  } catch (error) {
    console.error("Error fetching config:", error);
    return null;
  }
}

function isValidRuleStructure(rule) {
  if (!rule.initialMatch) {
    console.warn(`Rule ${rule.name} is missing initialMatch`);
    return false;
  }
  if (rule.elseIfActions && rule.elseIfActions.length > 0 && !rule.elseAction) {
    console.warn(`Rule ${rule.name} has elseIfActions but no elseAction`);
    return false;
  }
  return true;
}

async function findMatchingRule(request, config) {
  console.log("Finding matching rule for request:", request.url);
  if (!config || !Array.isArray(config.rules)) {
    console.warn("Invalid config structure");
    return null;
  }

  let lastLogOrSimulateAction = null;
  let lastElseAction = null;

  for (const rule of config.rules) {
    console.log("Evaluating rule:", rule.name);

    if (!isValidRuleStructure(rule)) {
      continue;
    }

    const initialMatches = await evaluateConditions(
      request,
      rule.initialMatch.conditions,
      "and", // Default to 'and' logic for initial match
    );
    console.log(`Initial match for rule ${rule.name}: ${initialMatches}`);

    if (initialMatches) {
      const actionType = rule.initialMatch.action.type;
      if (actionType === "log" || actionType === "simulate") {
        lastLogOrSimulateAction = {
          ...rule,
          actionType,
          action: rule.initialMatch.action,
        };
        console.log(
          `Rule ${rule.name} matched with ${actionType} action, continuing evaluation`,
        );
      } else {
        console.log(`Rule ${rule.name} matched with action: ${actionType}`);
        return { ...rule, actionType, action: rule.initialMatch.action };
      }
    } else if (rule.elseIfActions && rule.elseIfActions.length > 0) {
      for (const elseIfAction of rule.elseIfActions) {
        const elseIfMatches = await evaluateConditions(
          request,
          elseIfAction.conditions,
          elseIfAction.logic || "and",
        );
        console.log(`Else-if match for rule ${rule.name}: ${elseIfMatches}`);
        if (elseIfMatches) {
          const actionType = elseIfAction.action.type;
          if (actionType === "log" || actionType === "simulate") {
            lastLogOrSimulateAction = {
              ...rule,
              actionType,
              action: elseIfAction.action,
            };
            console.log(
              `Rule ${rule.name} else-if matched with ${actionType} action, continuing evaluation`,
            );
          } else {
            console.log(
              `Rule ${rule.name} else-if matched with action: ${actionType}`,
            );
            return { ...rule, actionType, action: elseIfAction.action };
          }
        }
      }
    }

    if (rule.elseAction) {
      lastElseAction = {
        ...rule,
        actionType: rule.elseAction.type,
        action: rule.elseAction,
      };
      console.log(`Rule ${rule.name} else action stored as potential fallback`);
    }

    console.log(`Finished evaluating rule ${rule.name}`);
  }

  // If we've reached here, no non-log/non-simulate actions were matched
  if (lastElseAction) {
    console.log(`Applying else action from rule: ${lastElseAction.name}`);
    return lastElseAction;
  }

  return lastLogOrSimulateAction;
}

async function handleRateLimit(request, env, matchingRule) {
  const rateLimiterId = env.RATE_LIMITER.idFromName("global");
  const rateLimiter = env.RATE_LIMITER.get(rateLimiterId);

  const headers = new Headers(request.headers);
  headers.set("X-Rate-Limit-Config", JSON.stringify(matchingRule));
  headers.set("Content-Type", "application/json");

  let payload;
  try {
    const clonedRequest = request.clone();
    payload = {
      cf: request.cf || {},
      body: await clonedRequest.text(),
    };
  } catch (error) {
    console.error("Error reading request body:", error);
    payload = { cf: request.cf || {}, body: "" };
  }

  const rateLimiterRequest = new Request(request.url, {
    method: "POST",
    headers: headers,
    body: JSON.stringify(payload),
  });

  const rateLimitResponse = await rateLimiter.fetch(rateLimiterRequest);
  return { rateLimitInfo: await rateLimitResponse.json(), rateLimitResponse };
}

function applyRateLimitHeaders(response, rateLimitResponse) {
  const newHeaders = new Headers(response.headers);
  [
    "X-Rate-Limit-Remaining",
    "X-Rate-Limit-Limit",
    "X-Rate-Limit-Period",
    "X-Rate-Limit-Reset",
  ].forEach((header) => {
    const value = rateLimitResponse.headers.get(header);
    if (value) {
      newHeaders.set(header, value);
      console.log("Set", header + ":", value);
    }
  });

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
}

const actionHandlers = {
  log: (request) => {
    console.log("Logging rate limit exceed");
    return fetch(request);
  },
  simulate: async (request) => {
    console.log("Simulating rate limit exceed");
    const response = await fetch(request);
    const newResponse = new Response(response.body, response);
    newResponse.headers.set("X-Rate-Limit-Simulated", "true");
    return newResponse;
  },
  block: () => {
    console.log("Blocking request due to rate limit");
    return new Response("Forbidden", { status: 403 });
  },
  customResponse: (env, request, rateLimitInfo, matchingRule) => {
    console.log("Applying custom response");
    return new Response(matchingRule.action.body, {
      status: parseInt(matchingRule.action.statusCode),
      headers: {
        "Content-Type": matchingRule.action.bodyType === "json"
          ? "application/json"
          : matchingRule.action.bodyType === "html"
          ? "text/html"
          : "text/plain",
      },
    });
  },
  rateLimit: (env, request, rateLimitInfo, matchingRule) => {
    console.log("Applying rate limit action");
    if (
      matchingRule.action && matchingRule.action.statusCode &&
      matchingRule.action.body
    ) {
      // Use custom response if defined in the rule
      return new Response(matchingRule.action.body, {
        status: parseInt(matchingRule.action.statusCode),
        headers: {
          "Content-Type": matchingRule.action.bodyType === "json"
            ? "application/json"
            : matchingRule.action.bodyType === "html"
            ? "text/html"
            : "text/plain",
        },
      });
    }
    // Default rate limit behavior
    return request.headers.get("Accept")?.includes("text/html")
      ? serveRateLimitPage(env, request, rateLimitInfo)
      : new Response(
        JSON.stringify({
          error: "Rate limit exceeded",
          retryAfter: rateLimitInfo.retryAfter,
        }),
        {
          status: 429,
          headers: {
            "Content-Type": "application/json",
            "Retry-After": rateLimitInfo.retryAfter.toString(),
          },
        },
      );
  },
};

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

export { ConfigStorage, RateLimiter };
