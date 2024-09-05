import { RateLimitDO } from './rate_limiter.js';

export { RateLimitDO };

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const id = env.RATE_LIMIT_DO.idFromName(url.pathname);
    const obj = env.RATE_LIMIT_DO.get(id);
    return obj.fetch(request);
  },
};
