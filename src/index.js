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

    let config;
    try {
      // Fetch config from ConfigStorage Durable Object
      const configStorageId = env.CONFIG_STORAGE.idFromName('global');
      const configStorage = env.CONFIG_STORAGE.get(configStorageId);
      const configResponse = await configStorage.fetch(
        new Request('https://rate-limiter-ui/config', { method: 'GET' })
      );
      const rawConfig = await configResponse.json();
      console.log('Received raw config:', JSON.stringify(rawConfig, null, 2));

      // If no rules are configured, pass through the request
      if (!rawConfig || !rawConfig.rules || rawConfig.rules.length === 0) {
        console.log('No rate limiting rules configured, passing through request');
        return fetch(request);
      }

      config = rawConfig;
      console.log('Parsed config:', JSON.stringify(config, null, 2));
    } catch (error) {
      console.error('Configuration error:', error);
      return fetch(request); // Pass through on config error
    }

    // Find the first matching rule
    const matchingRule = await findMatchingRule(request, config.rules);

    if (matchingRule) {
      console.log('Request matches criteria for rule:', matchingRule.name);

      const actionType = matchingRule.action?.type || 'rateLimit'; // Default to rateLimit if not specified
      console.log('Action type:', actionType);

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

      console.log('Checking rate limit');
      try {
        const clientIP =
          request.headers.get('CF-Connecting-IP') ||
          request.headers.get('X-Forwarded-For') ||
          request.headers.get('True-Client-IP') ||
          'unknown';
        console.log('Client IP:', clientIP);

        const rateLimiterRequest = new Request(request.url, {
          method: request.method,
          headers: {
            ...request.headers,
            'X-Rate-Limit-Config': JSON.stringify(matchingRule),
            'CF-Connecting-IP': clientIP,
            'X-CF-Data': JSON.stringify(request.cf || {}), // Add this line
          },
          body: request.body,
        });
        const rateLimitResponse = await rateLimiter.fetch(rateLimiterRequest);
        const rateLimitInfo = await rateLimitResponse.json();

        console.log('Rate limit response:', rateLimitInfo);

        let response;
        let statusCode;

        if (rateLimitInfo.allowed) {
          // Rate limit not exceeded
          console.log('Rate limit not exceeded, forwarding request');
          response = await fetch(request);
          statusCode = response.status;

          if (actionType === 'simulate') {
            response = new Response(response.body, response);
            response.headers.set('X-Rate-Limit-Simulated', 'false');
          }
        } else {
          // Rate limit exceeded
          console.log('Rate limit exceeded, applying action:', actionType);
          switch (actionType) {
            case 'log':
              console.log('Logging rate limit exceed:', rateLimitInfo);
              response = await fetch(request);
              statusCode = response.status;
              break;
            case 'simulate':
              console.log('Simulating rate limit exceed:', rateLimitInfo);
              response = await fetch(request);
              response = new Response(response.body, response);
              response.headers.set('X-Rate-Limit-Simulated', 'true');
              statusCode = response.status;
              break;
            case 'block':
              console.log('Blocking request due to rate limit');
              response = new Response('Forbidden', { status: 403 });
              statusCode = 403;
              break;
            case 'customResponse':
              console.log('Applying custom response due to rate limit');
              statusCode = parseInt(matchingRule.action.statusCode);
              response = new Response(matchingRule.action.body, {
                status: statusCode,
                headers: { 'Content-Type': 'application/json' },
              });
              break;
            case 'rateLimit':
            default:
              console.log('Serving rate limit page');
              const acceptHeader = request.headers.get('Accept') || '';
              if (acceptHeader.includes('text/html')) {
                // Serve HTML rate limit page for web users
                response = serveRateLimitPage(env, request, rateLimitInfo);
              } else {
                // Serve JSON response for non-web requests
                response = new Response(
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
              }
              statusCode = 429;
              break;
          }
        }

        console.log('Response status:', statusCode);

        // Apply rate limit headers
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

        // Create a new response with the updated headers
        response = new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: newHeaders,
        });

        return response;
      } catch (error) {
        console.error('Rate limiting error:', error);
        return fetch(request); // Pass through on rate limiting error
      }
    }

    // If request doesn't match any rule, pass through to origin
    console.log('Request does not match any criteria, passing through to origin');
    return fetch(request);
  },
};

export { RateLimiter, ConfigStorage };
