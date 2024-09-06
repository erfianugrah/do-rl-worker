import { RateLimiter } from './rate-limiter.js';
import { config } from './config.js';
import { serveRateLimitPage, serveRateLimitInfoPage } from './staticpages.js';

export default {
  async fetch(request, env, ctx) {
    console.log('Received request for URL:', request.url);
    console.log('Rate limit config:', config);

    const url = new URL(request.url);

    // Serve rate limit info page
    if (url.pathname === config.staticPages.rateLimitInfoPath) {
      const rateLimiterId = env.RATE_LIMITER.idFromName('global');
      const rateLimiter = env.RATE_LIMITER.get(rateLimiterId);
      const rateLimitInfo = await rateLimiter.getRateLimitInfo(request);
      return serveRateLimitInfoPage(env, request, rateLimitInfo);
    }

    if (
      config.requestMatch.hostname === url.hostname &&
      (!config.requestMatch.path || url.pathname.startsWith(config.requestMatch.path))
    ) {
      console.log('Request matches rate limit criteria');

      const rateLimiterId = env.RATE_LIMITER.idFromName('global');
      const rateLimiter = env.RATE_LIMITER.get(rateLimiterId);

      const rateLimitResponse = await rateLimiter.fetch(request);

      console.log('Rate limit response status:', rateLimitResponse.status);

      if (rateLimitResponse.status === 429) {
        console.log('Rate limit exceeded');
        const rateLimitInfo = {
          retryAfter: rateLimitResponse.headers.get('Retry-After'),
          limit: config.rateLimit.limit,
          period: config.rateLimit.period,
        };
        return serveRateLimitPage(env, request, rateLimitInfo);
      }

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
    }

    console.log('Request does not match rate limit criteria, passing through');
    return fetch(request);
  },
};

export { RateLimiter };
