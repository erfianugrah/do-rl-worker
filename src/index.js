import { RateLimiter } from './rate-limiter.js';
import { serveRateLimitPage, serveRateLimitInfoPage } from './staticpages.js';

// Hardcoded path for rate limit info
const RATE_LIMIT_INFO_PATH = '/_ratelimit';

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
      if (!rawConfig || Object.keys(rawConfig).length === 0) {
        console.log('No rate limiting rules configured, passing through request');
        return fetch(request);
      }

      // Parse config
      config = {
        rateLimit: {
          ipLimit: parseInt(rawConfig.rateLimit.ipLimit, 10),
          ipPeriod: parseInt(rawConfig.rateLimit.ipPeriod, 10),
        },
        requestMatch: rawConfig.requestMatch,
      };

      // Add fingerprint config only if it's present in rawConfig
      if (rawConfig.rateLimit.limit && rawConfig.rateLimit.period) {
        config.rateLimit.limit = parseInt(rawConfig.rateLimit.limit, 10);
        config.rateLimit.period = parseInt(rawConfig.rateLimit.period, 10);
        config.fingerprint = {
          parameters: rawConfig.fingerprint.parameters || ['clientIP'],
        };
      }

      console.log('Parsed config:', JSON.stringify(config, null, 2));
    } catch (error) {
      console.error('Configuration error:', error);
      return fetch(request); // Pass through on config error
    }

    const url = new URL(request.url);

    // If config matches the request, apply rate limiting
    if (
      config.requestMatch.hostname === url.hostname &&
      (!config.requestMatch.path || url.pathname.startsWith(config.requestMatch.path))
    ) {
      console.log('Request matches rate limit criteria');

      const rateLimiterId = env.RATE_LIMITER.idFromName('global');
      const rateLimiter = env.RATE_LIMITER.get(rateLimiterId);

      // Serve rate limit info page
      if (url.pathname === RATE_LIMIT_INFO_PATH) {
        console.log('Serving rate limit info page');
        const rateLimiterRequest = new Request(request.url, {
          method: request.method,
          headers: {
            ...request.headers,
            'X-Rate-Limit-Config': JSON.stringify(config),
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
            'X-Rate-Limit-Config': JSON.stringify(config),
          },
          body: request.body,
        });
        const rateLimitResponse = await rateLimiter.fetch(rateLimiterRequest);

        console.log('Rate limit response status:', rateLimitResponse.status);

        if (rateLimitResponse.status === 429) {
          console.log('Rate limit exceeded');
          const rateLimitInfo = await rateLimitResponse.json();
          return serveRateLimitPage(env, request, rateLimitInfo);
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

    // If request doesn't match config criteria, pass through to origin
    console.log('Request does not match rate limit criteria, passing through to origin');
    return fetch(request);
  },
};

export { RateLimiter };
