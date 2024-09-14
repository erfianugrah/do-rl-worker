export class ConfigStorage {
  constructor(state, env) {
    this.state = state;
  }

  async fetch(request) {
    if (request.method === 'GET') {
      const config = await this.state.storage.get('config');
      return new Response(config || '{"version":"1.0","rules":[]}', {
        headers: { 'Content-Type': 'application/json' },
      });
    } else if (request.method === 'POST') {
      const config = await request.json();
      config.version = '1.0';

      if (config.rules) {
        config.rules.forEach((rule) => {
          if (rule.rateLimit) {
            rule.rateLimit.limit = Number(rule.rateLimit.limit);
            rule.rateLimit.period = Number(rule.rateLimit.period);
          }
          if (rule.action && rule.action.type === 'customResponse') {
            rule.action.statusCode = Number(rule.action.statusCode);
          }
        });
      }

      await this.state.storage.put('config', JSON.stringify(config));
      return new Response('Config saved', { status: 200 });
    }
    return new Response('Method not allowed', { status: 405 });
  }
}
