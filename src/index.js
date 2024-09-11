import { RateLimiter } from './rate-limiter.js';
import { ConfigStorage } from './config-storage.js';
import { serveRateLimitPage, serveRateLimitInfoPage } from './staticpages.js';
import { evaluateCondition } from './condition-evaluator.js';

// Cache configuration
let cachedConfig = null;
let lastConfigFetch = 0;
const CONFIG_CACHE_TTL = 60 * 1000; // 1 minute

async function getConfig(env) {
  const now = Date.now();
  if (cachedConfig && now - lastConfigFetch < CONFIG_CACHE_TTL) {
    return cachedConfig;
  }

  const configStorageId = env.CONFIG_STORAGE.idFromName('global');
  const configStorage = env.CONFIG_STORAGE.get(configStorageId);
  const configResponse = await configStorage.fetch(
    new Request('https://rate-limiter-ui/config', { method: 'GET' })
  );
  cachedConfig = await configResponse.json();
  lastConfigFetch = now;
  return cachedConfig;
}

async function findMatchingRule(request, rules) {
  console.log('Finding matching rule for request:', request.url);
  for (const rule of rules) {
    console.log('Evaluating rule:', rule.name);
    const matches = await evaluateRequestMatch(request, rule.requestMatch);
    console.log(`Rule ${rule.name} matches: ${matches}`);
    if (matches) return rule;
  }
  return null;
}

async function evaluateRequestMatch(request, requestMatch) {
  console.log('Evaluating request match:', JSON.stringify(requestMatch));

  if (!requestMatch) return true;

  const conditions = Object.entries(requestMatch)
    .filter(([key]) => key.startsWith('conditions['))
    .map(([, value]) => value);

  if (conditions.length === 0) return true;

  const logic = requestMatch.logic || 'AND';
  console.log('Request match logic:', logic);

  if (logic === 'AND') {
    for (const condition of conditions) {
      if (!(await evaluateCondition(request, condition))) return false;
    }
    return true;
  } else if (logic === 'OR') {
    for (const condition of conditions) {
      if (await evaluateCondition(request, condition)) return true;
    }
    return false;
  }

  throw new Error(`Unknown logic operator: ${logic}`);
}

async function handleRateLimit(request, env, matchingRule) {
  const rateLimiterId = env.RATE_LIMITER.idFromName('global');
  const rateLimiter = env.RATE_LIMITER.get(rateLimiterId);

  const headers = new Headers(request.headers);
  headers.set('X-Rate-Limit-Config', JSON.stringify(matchingRule));
  headers.set('Content-Type', 'application/json');

  const payload = {
    originalUrl: request.url,
    method: request.method,
    cf: request.cf || {},
  };

  const rateLimiterRequest = new Request(request.url, {
    method: 'POST', // Change to POST to send a body
    headers: headers,
    body: JSON.stringify(payload),
  });

  const rateLimitResponse = await rateLimiter.fetch(rateLimiterRequest);
  return { rateLimitInfo: await rateLimitResponse.json(), rateLimitResponse };
}

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
      console.log('Set', header + ':', value);
    }
  });

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
}

const actionHandlers = {
  log: async (request) => {
    console.log('Logging rate limit exceed');
    return fetch(request);
  },
  simulate: async (request) => {
    console.log('Simulating rate limit exceed');
    const response = await fetch(request);
    const newResponse = new Response(response.body, response);
    newResponse.headers.set('X-Rate-Limit-Simulated', 'true');
    return newResponse;
  },
  block: () => {
    console.log('Blocking request due to rate limit');
    return new Response('Forbidden', { status: 403 });
  },
  customResponse: (matchingRule) => {
    console.log('Applying custom response due to rate limit');
    return new Response(matchingRule.action.body, {
      status: parseInt(matchingRule.action.statusCode),
      headers: { 'Content-Type': 'application/json' },
    });
  },
  rateLimit: (env, request, rateLimitInfo) => {
    console.log('Serving rate limit page');
    return request.headers.get('Accept')?.includes('text/html')
      ? serveRateLimitPage(env, request, rateLimitInfo)
      : new Response(
          JSON.stringify({
            error: 'Rate limit exceeded',
            retryAfter: rateLimitInfo.retryAfter,
          }),
          {
            status: 429,
            headers: {
              'Content-Type': 'application/json',
              'Retry-After': rateLimitInfo.retryAfter.toString(),
            },
          }
        );
  },
};

export default {
  async fetch(request, env, ctx) {
    console.log('Received request for URL:', request.url);
    const url = new URL(request.url);

    if (url.pathname === '/config') {
      const configStorageId = env.CONFIG_STORAGE.idFromName('global');
      const configStorage = env.CONFIG_STORAGE.get(configStorageId);
      return configStorage.fetch(request);
    }

    if (request.headers.get('X-Serve-Rate-Limit-Page') === 'true') {
      const rateLimitInfo = JSON.parse(request.headers.get('X-Rate-Limit-Info') || '{}');
      return serveRateLimitPage(env, request, rateLimitInfo);
    }

    try {
      const config = await getConfig(env);

      if (!config?.rules?.length) {
        console.log('No rate limiting rules configured, passing through request');
        return fetch(request);
      }

      const matchingRule = await findMatchingRule(request, config.rules);

      if (!matchingRule) {
        console.log('Request does not match any criteria, passing through to origin');
        return fetch(request);
      }

      console.log('Request matches criteria for rule:', matchingRule.name);

      const actionType = matchingRule.action?.type || 'rateLimit';
      console.log('Action type:', actionType);

      if (url.pathname === env.RATE_LIMIT_INFO_PATH) {
        console.log('Serving rate limit info page');
        const { rateLimitInfo } = await handleRateLimit(request, env, matchingRule);
        return serveRateLimitInfoPage(env, request, rateLimitInfo);
      }

      const { rateLimitInfo, rateLimitResponse } = await handleRateLimit(
        request,
        env,
        matchingRule
      );

      let response;
      if (rateLimitInfo.allowed) {
        console.log('Rate limit not exceeded, forwarding request');
        response = await fetch(request);

        if (actionType === 'simulate') {
          response = new Response(response.body, response);
          response.headers.set('X-Rate-Limit-Simulated', 'false');
        }
      } else {
        console.log('Rate limit exceeded, applying action:', actionType);
        response = await (actionHandlers[actionType] || actionHandlers.rateLimit)(
          env,
          request,
          rateLimitInfo,
          matchingRule
        );
      }

      return applyRateLimitHeaders(response, rateLimitResponse);
    } catch (error) {
      console.error('Error in rate limiting:', error);
      return fetch(request); // Pass through on error
    }
  },
};

export { RateLimiter, ConfigStorage };
