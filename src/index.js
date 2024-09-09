import { RateLimiter } from './rate-limiter.js';
import { serveRateLimitPage, serveRateLimitInfoPage } from './staticpages.js';
import { evaluateCondition } from './condition-evaluator.js';

async function findMatchingRule(request, rules) {
  for (const rule of rules) {
    if (await evaluateRequestMatch(request, rule.requestMatch)) {
      return rule;
    }
  }
  return null;
}

async function evaluateRequestMatch(request, requestMatch) {
  if (
    !requestMatch ||
    !requestMatch.conditions ||
    Object.keys(requestMatch.conditions).length === 0
  ) {
    return true; // If no conditions are specified, the request matches by default
  }

  const logic = requestMatch.logic || 'AND'; // Default to AND if not specified
  const conditions = Object.values(requestMatch.conditions);

  if (logic === 'AND') {
    for (const condition of conditions) {
      if (!(await evaluateCondition(request, condition))) {
        return false;
      }
    }
    return true;
  } else if (logic === 'OR') {
    for (const condition of conditions) {
      if (await evaluateCondition(request, condition)) {
        return true;
      }
    }
    return false;
  }

  throw new Error(`Unknown logic operator: ${logic}`);
}

export default {
  async fetch(request, env, ctx) {
    console.log('Received request for URL:', request.url);

    let config;
    try {
      // Fetch config from UI worker using Service Binding
      console.log('Fetching config from UI worker');
      const configResponse = await env.UI_WORKER.fetch('https://ui-worker.example.com/config');
      if (!configResponse.ok) {
        throw new Error(
          `Failed to fetch config from UI worker: ${configResponse.status} ${configResponse.statusText}`
        );
      }
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

    const url = new URL(request.url);

    // Find the first matching rule
    const matchingRule = await findMatchingRule(request, config.rules);

    if (matchingRule) {
      console.log('Request matches rate limit criteria for rule:', matchingRule.name);

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

      console.log('Calling RateLimiter Durable Object');
      try {
        const rateLimiterRequest = new Request(request.url, {
          method: request.method,
          headers: {
            ...request.headers,
            'X-Rate-Limit-Config': JSON.stringify(matchingRule),
          },
          body: request.body,
        });
        const rateLimitResponse = await rateLimiter.fetch(rateLimiterRequest);

        console.log('Rate limit response status:', rateLimitResponse.status);

        if (rateLimitResponse.status === 429) {
          console.log('Rate limit exceeded');
          const rateLimitInfo = await rateLimitResponse.json();

          // Handle different actions
          const actionType = matchingRule.action?.type || 'rateLimit'; // Default to rateLimit if not specified
          switch (actionType) {
            case 'log':
              console.log('Logging rate limit exceed:', rateLimitInfo);
              // Pass through the request
              return fetch(request);
            case 'simulate':
              console.log('Simulating rate limit exceed:', rateLimitInfo);
              // Pass through the request, but add a header to indicate simulation
              const simulatedResponse = await fetch(request);
              const newSimulatedResponse = new Response(simulatedResponse.body, simulatedResponse);
              newSimulatedResponse.headers.set('X-Rate-Limit-Simulated', 'true');
              return newSimulatedResponse;
            case 'block':
              return new Response('Forbidden', { status: 403 });
            case 'rateLimit':
              return serveRateLimitPage(env, request, rateLimitInfo);
            case 'customResponse':
              return new Response(matchingRule.action.body, {
                status: matchingRule.action.statusCode,
                headers: { 'Content-Type': 'application/json' },
              });
            default:
              console.error('Unknown action type:', actionType);
              return fetch(request);
          }
        }

        // If rate limit not exceeded, forward the request
        console.log('Rate limit not exceeded, forwarding request');
        const response = await fetch(request);

        const newResponse = new Response(response.body, response);
        [
          'X-Rate-Limit-Remaining',
          'X-Rate-Limit-Limit',
          'X-Rate-Limit-Period',
          'X-Rate-Limit-Reset',
        ].forEach((header) => {
          const value = rateLimitResponse.headers.get(header);
          if (value) {
            newResponse.headers.set(header, value);
            console.log('Set', header + ':', value);
          }
        });

        return newResponse;
      } catch (error) {
        console.error('Rate limiting error:', error);
        return fetch(request); // Pass through on rate limiting error
      }
    }

    // If request doesn't match any rule, pass through to origin
    console.log('Request does not match any rate limit criteria, passing through to origin');
    return fetch(request);
  },
};

export { RateLimiter };
