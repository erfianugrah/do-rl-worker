import { RateLimiter } from './rate-limiter.js';
import { ConfigStorage } from './config-storage.js';
import { serveRateLimitPage, serveRateLimitInfoPage } from './staticpages.js';
import { evaluateConditions } from './condition-evaluator.js';

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
  const configResponse = await configStorage.fetch(new Request('https://rate-limiter-ui/config'));
  cachedConfig = await configResponse.json();
  lastConfigFetch = now;

  if (!cachedConfig.version || cachedConfig.version !== '1.0') {
    console.warn('Unsupported config version:', cachedConfig.version);
  }

  return cachedConfig;
}

async function findMatchingRule(request, rules) {
  console.log('Finding matching rule for request:', request.url);
  for (const rule of rules) {
    console.log('Evaluating rule:', rule.name);

    const matches = await evaluateConditions(
      request,
      rule.initialMatch.conditions,
      rule.initialMatch.logic
    );
    console.log(`Rule ${rule.name} matches: ${matches}`);
    if (matches) return rule;
  }
  return null;
}

async function evaluateRequestMatch(request, requestMatch) {
  console.log('Evaluating request match:', JSON.stringify(requestMatch, null, 2));

  if (!requestMatch || !requestMatch.conditions) return true;

  return await evaluateConditions(request, requestMatch.conditions, requestMatch.logic);
}

async function handleRateLimit(request, env, matchingRule) {
  const rateLimiterId = env.RATE_LIMITER.idFromName('global');
  const rateLimiter = env.RATE_LIMITER.get(rateLimiterId);

  const headers = new Headers(request.headers);
  headers.set('X-Rate-Limit-Config', JSON.stringify(matchingRule));
  headers.set('Content-Type', 'application/json');

  let payload;
  try {
    const clonedRequest = request.clone();
    payload = {
      cf: request.cf || {},
      body: await clonedRequest.text(),
    };
  } catch (error) {
    console.error('Error reading request body:', error);
    payload = { cf: request.cf || {}, body: '' };
  }

  const rateLimiterRequest = new Request(request.url, {
    method: 'POST',
    headers,
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
  log: (request) => {
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
