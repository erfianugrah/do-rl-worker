import { RateLimiter } from './rate-limiter.js';
import { ConfigStorage } from './config-storage.js';
import { serveRateLimitPage, serveRateLimitInfoPage } from './staticpages.js';
import { evaluateCondition } from './condition-evaluator.js';

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

  const logic = requestMatch.logic || 'AND';
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

async function handleConfigRequest(env, request) {
  const configStorageId = env.CONFIG_STORAGE.idFromName('global');
  const configStorage = env.CONFIG_STORAGE.get(configStorageId);
  return configStorage.fetch(request);
}

async function handleRateLimitPageRequest(env, request) {
  const rateLimitInfo = JSON.parse(request.headers.get('X-Rate-Limit-Info') || '{}');
  return serveRateLimitPage(env, request, rateLimitInfo);
}

async function fetchConfig(env) {
  const configStorageId = env.CONFIG_STORAGE.idFromName('global');
  const configStorage = env.CONFIG_STORAGE.get(configStorageId);
  const configResponse = await configStorage.fetch(
    new Request('https://dummy-url/config', { method: 'GET' })
  );
  return await configResponse.json();
}

async function applyRateLimit(env, request, matchingRule) {
  const rateLimiterId = env.RATE_LIMITER.idFromName('global');
  const rateLimiter = env.RATE_LIMITER.get(rateLimiterId);

  const clientIP =
    request.headers.get('CF-Connecting-IP') ||
    request.headers.get('X-Forwarded-For') ||
    request.headers.get('True-Client-IP') ||
    'unknown';

  const cfData = JSON.stringify(request.cf || {});

  const rateLimiterRequest = new Request(request.url, {
    method: request.method,
    headers: {
      ...request.headers,
      'X-Rate-Limit-Config': JSON.stringify(matchingRule),
      'CF-Connecting-IP': clientIP,
      'X-Original-CF-Data': cfData,
    },
    body: request.body,
  });

  const rateLimitResponse = await rateLimiter.fetch(rateLimiterRequest);
  const rateLimitInfo = await rateLimitResponse.json();

  return { rateLimitResponse, rateLimitInfo };
}

async function handleRateLimitedRequest(env, request, matchingRule, rateLimitInfo) {
  const actionType = matchingRule.action?.type || 'rateLimit';
  let response;
  let statusCode;

  switch (actionType) {
    case 'log':
      console.log('Logging rate limit exceed:', rateLimitInfo);
      response = await fetch(request);
      statusCode = response.status;
      break;
    case 'simulate':
      response = await fetch(request);
      response = new Response(response.body, response);
      response.headers.set('X-Rate-Limit-Simulated', 'true');
      statusCode = response.status;
      break;
    case 'block':
      response = new Response('Forbidden', { status: 403 });
      statusCode = 403;
      break;
    case 'customResponse':
      statusCode = parseInt(matchingRule.action.statusCode);
      response = new Response(matchingRule.action.body, {
        status: statusCode,
        headers: { 'Content-Type': 'application/json' },
      });
      break;
    case 'rateLimit':
    default:
      const acceptHeader = request.headers.get('Accept') || '';
      if (acceptHeader.includes('text/html')) {
        response = serveRateLimitPage(env, request, {
          ...rateLimitInfo,
          limit: matchingRule.rateLimit.limit,
          period: matchingRule.rateLimit.period,
          retryAfter: rateLimitInfo.retryAfter || 0,
        });
      } else {
        response = new Response(
          JSON.stringify({
            error: 'Rate limit exceeded',
            ...rateLimitInfo,
          }),
          {
            status: 429,
            headers: {
              'Content-Type': 'application/json',
              'Retry-After': (rateLimitInfo.retryAfter || 0).toString(),
            },
          }
        );
      }
      statusCode = 429;
      break;
  }

  return { response, statusCode };
}

function applyRateLimitHeaders(response, rateLimitResponse) {
  const newHeaders = new Headers(response.headers);
  [
    'X-Rate-Limit-Remaining',
    'X-Rate-Limit-Limit',
    'X-Rate-Limit-Period',
    'X-Rate-Limit-Reset',
    'X-Rate-Limit-Retry-After',
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

export default {
  async fetch(request, env, ctx) {
    console.log('Received request for URL:', request.url);

    const url = new URL(request.url);

    if (url.pathname === '/config') {
      return handleConfigRequest(env, request);
    }

    if (request.headers.get('X-Serve-Rate-Limit-Page') === 'true') {
      return handleRateLimitPageRequest(env, request);
    }

    try {
      const config = await fetchConfig(env);

      if (!config || !config.rules || config.rules.length === 0) {
        console.log('No rate limiting rules configured, passing through request');
        return fetch(request);
      }

      const matchingRule = await findMatchingRule(request, config.rules);

      if (matchingRule) {
        console.log('Request matches criteria for rule:', matchingRule.name);

        if (url.pathname === env.RATE_LIMIT_INFO_PATH) {
          console.log('Serving rate limit info page');
          const { rateLimitInfo } = await applyRateLimit(env, request, matchingRule);
          return serveRateLimitInfoPage(env, request, rateLimitInfo);
        }

        const { rateLimitResponse, rateLimitInfo } = await applyRateLimit(
          env,
          request,
          matchingRule
        );

        if (rateLimitInfo.allowed) {
          console.log('Rate limit not exceeded, forwarding request');
          let response = await fetch(request);
          if (matchingRule.action?.type === 'simulate') {
            response = new Response(response.body, response);
            response.headers.set('X-Rate-Limit-Simulated', 'false');
          }
          return applyRateLimitHeaders(response, rateLimitResponse);
        } else {
          console.log('Rate limit exceeded, applying action:', matchingRule.action?.type);
          const { response, statusCode } = await handleRateLimitedRequest(
            env,
            request,
            matchingRule,
            rateLimitInfo
          );
          return applyRateLimitHeaders(response, rateLimitResponse);
        }
      }

      console.log('Request does not match any criteria, passing through to origin');
      return fetch(request);
    } catch (error) {
      console.error('Unexpected error:', error);
      return new Response('Internal Server Error', { status: 500 });
    }
  },
};

export { RateLimiter, ConfigStorage };
