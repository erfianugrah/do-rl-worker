import { RateLimiter } from './rate-limiter.js';
import { ConfigStorage } from './config-storage.js';
import { serveRateLimitPage, serveRateLimitInfoPage } from './staticpages.js';
import { evaluateCondition } from './condition-evaluator.js';

// Fetch configuration from ConfigStorage Durable Object
async function fetchConfig(env) {
  try {
    const configStorageId = env.CONFIG_STORAGE.idFromName('global');
    const configStorage = env.CONFIG_STORAGE.get(configStorageId);
    const configResponse = await configStorage.fetch(
      new Request('https://rate-limiter-ui/config', { method: 'GET' })
    );
    return await configResponse.json();
  } catch (error) {
    console.error('Error fetching configuration:', error);
    return null;
  }
}

// Handle rate limiting logic
async function handleRateLimit(request, env, matchingRule, rateLimiter) {
  const clientIP =
    request.headers.get('CF-Connecting-IP') ||
    request.headers.get('X-Forwarded-For') ||
    request.headers.get('True-Client-IP') ||
    'unknown';

  const rateLimiterRequest = new Request(request.url, {
    method: request.method,
    headers: {
      ...request.headers,
      'X-Rate-Limit-Config': JSON.stringify(matchingRule),
      'CF-Connecting-IP': clientIP,
      'X-CF-Data': JSON.stringify(request.cf || {}),
    },
    body: request.body,
  });

  const rateLimitResponse = await rateLimiter.fetch(rateLimiterRequest);
  const rateLimitInfo = await rateLimitResponse.json();

  return { rateLimitInfo, rateLimitResponse };
}

// Apply rate limit headers to the response
function applyRateLimitHeaders(response, rateLimitResponse) {
  const newHeaders = new Headers(response.headers);
  [
    'X-Rate-Limit-Remaining',
    'X-Rate-Limit-Limit',
    'X-Rate-Limit-Period',
    'X-Rate-Limit-Reset',
  ].forEach((header) => {
    const value = rateLimitResponse.headers.get(header);
    if (value) {
      newHeaders.set(header, value);
    }
  });

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
}

// Define action handlers in an object
const actionHandlers = {
  log: async (request, rateLimitInfo) => {
    console.log('Logging rate limit exceed:', rateLimitInfo);
    const response = await fetch(request);
    return { response, statusCode: response.status };
  },
  simulate: async (request, rateLimitInfo) => {
    console.log('Simulating rate limit exceed:', rateLimitInfo);
    let response = await fetch(request);
    response = new Response(response.body, response);
    response.headers.set('X-Rate-Limit-Simulated', 'true');
    return { response, statusCode: response.status };
  },
  block: async () => {
    console.log('Blocking request due to rate limit');
    const response = new Response('Forbidden', { status: 403 });
    return { response, statusCode: 403 };
  },
  customResponse: async (request, matchingRule) => {
    console.log('Applying custom response due to rate limit');
    const statusCode = parseInt(matchingRule.action.statusCode);
    const response = new Response(matchingRule.action.body, {
      status: statusCode,
      headers: { 'Content-Type': 'application/json' },
    });
    return { response, statusCode };
  },
  rateLimit: async (request, env, rateLimitInfo) => {
    console.log('Serving rate limit page');
    const acceptHeader = request.headers.get('Accept') || '';
    let response;
    if (acceptHeader.includes('text/html')) {
      response = serveRateLimitPage(env, request, rateLimitInfo);
    } else {
      const retryAfter =
        rateLimitInfo.retryAfter !== undefined ? rateLimitInfo.retryAfter.toString() : '0';
      response = new Response(
        JSON.stringify({
          error: 'Rate limit exceeded',
          retryAfter: retryAfter,
        }),
        {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': retryAfter,
          },
        }
      );
    }
    return { response, statusCode: 429 };
  },
};

// Process rate limit action based on actionType
async function processRateLimitAction(request, env, matchingRule, rateLimitInfo, actionType) {
  const handler = actionHandlers[actionType] || actionHandlers.rateLimit;
  return handler(request, env, rateLimitInfo, matchingRule);
}

// Evaluate request match based on conditions
async function evaluateRequestMatch(request, requestMatch) {
  console.log('Evaluating request match:', JSON.stringify(requestMatch));

  if (!requestMatch) {
    console.log('No requestMatch specified, request matches by default');
    return true;
  }

  const conditions = Object.entries(requestMatch)
    .filter(([key]) => key.startsWith('conditions['))
    .map(([, value]) => value);

  if (conditions.length === 0) {
    console.log('No conditions specified, request matches by default');
    return true;
  }

  const logic = requestMatch.logic || 'AND'; // Default to AND if not specified
  console.log('Request match logic:', logic);

  if (logic === 'AND') {
    for (const condition of conditions) {
      const result = await evaluateCondition(request, condition);
      console.log(`Evaluating condition: ${JSON.stringify(condition)}, result: ${result}`);
      if (!result) {
        console.log('AND condition failed:', condition);
        return false;
      }
    }
    console.log('All AND conditions passed');
    return true;
  } else if (logic === 'OR') {
    for (const condition of conditions) {
      const result = await evaluateCondition(request, condition);
      console.log(`Evaluating condition: ${JSON.stringify(condition)}, result: ${result}`);
      if (result) {
        console.log('OR condition passed:', condition);
        return true;
      }
    }
    console.log('No OR conditions passed');
    return false;
  }

  console.error('Unknown logic operator:', logic);
  throw new Error(`Unknown logic operator: ${logic}`);
}

// Find the first matching rule for the request
async function findMatchingRule(request, rules) {
  console.log('Finding matching rule for request:', request.url);
  for (const rule of rules) {
    console.log('Evaluating rule:', rule.name);
    console.log('Rule details:', JSON.stringify(rule));
    const matches = await evaluateRequestMatch(request, rule.requestMatch);
    console.log(`Rule ${rule.name} matches: ${matches}`);
    if (matches) {
      console.log('Matching rule found:', rule.name);
      return rule;
    }
  }
  console.log('No matching rule found');
  return null;
}

export default {
  async fetch(request, env, ctx) {
    console.log('Received request for URL:', request.url);
    const url = new URL(request.url);

    // Handle configuration requests
    if (url.pathname === '/config') {
      const configStorageId = env.CONFIG_STORAGE.idFromName('global');
      const configStorage = env.CONFIG_STORAGE.get(configStorageId);
      return configStorage.fetch(request);
    }

    // Check if this is a request for the rate limit page itself
    if (request.headers.get('X-Serve-Rate-Limit-Page') === 'true') {
      const rateLimitInfo = JSON.parse(request.headers.get('X-Rate-Limit-Info') || '{}');
      return serveRateLimitPage(env, request, rateLimitInfo);
    }

    // Fetch configuration
    const config = await fetchConfig(env);
    if (!config || !config.rules || config.rules.length === 0) {
      console.log('No rate limiting rules configured, passing through request');
      return fetch(request);
    }

    // Find the first matching rule
    const matchingRule = await findMatchingRule(request, config.rules);
    if (!matchingRule) {
      console.log('Request does not match any criteria, passing through to origin');
      return fetch(request);
    }

    console.log('Request matches criteria for rule:', matchingRule.name);
    const actionType = matchingRule.action?.type || 'rateLimit';

    const rateLimiterId = env.RATE_LIMITER.idFromName('global');
    const rateLimiter = env.RATE_LIMITER.get(rateLimiterId);

    // Serve rate limit info page
    if (url.pathname === env.RATE_LIMIT_INFO_PATH) {
      console.log('Serving rate limit info page');
      const rateLimiterRequest = new Request(request.url, {
        method: request.method,
        headers: {
          ...request.headers,
          'X-Rate-Limit-Config': JSON.stringify(matchingRule),
        },
      });
      const rateLimitInfoResponse = await rateLimiter.fetch(rateLimiterRequest);
      const rateLimitInfo = await rateLimitInfoResponse.json();
      return serveRateLimitInfoPage(env, request, rateLimitInfo);
    }

    // Handle rate limiting
    try {
      const { rateLimitInfo, rateLimitResponse } = await handleRateLimit(
        request,
        env,
        matchingRule,
        rateLimiter
      );

      let { response, statusCode } = await processRateLimitAction(
        request,
        env,
        matchingRule,
        rateLimitInfo,
        actionType
      );

      console.log('Response status:', statusCode);

      // Apply rate limit headers
      response = applyRateLimitHeaders(response, rateLimitResponse);

      return response;
    } catch (error) {
      console.error('Rate limiting error:', error);
      return fetch(request); // Pass through on rate limiting error
    }
  },
};

export { RateLimiter, ConfigStorage };
