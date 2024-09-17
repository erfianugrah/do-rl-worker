export class ConfigStorage {
  constructor(state, env) {
    this.state = state;
  }

  async fetch(request) {
    console.log(`ConfigStorage: Received ${request.method} request`);

    if (request.method === 'GET') {
      try {
        const config = await this.state.storage.get('config');
        console.log('ConfigStorage: Retrieved config:', config);
        return new Response(config || '{"version":"1.0","rules":[]}', {
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (error) {
        console.error('ConfigStorage: Error retrieving config:', error);
        return new Response(JSON.stringify({ error: 'Failed to retrieve configuration' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    } else if (request.method === 'POST') {
      try {
        const config = await request.json();
        console.log('ConfigStorage: Received new config:', JSON.stringify(config));

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

        const stringifiedConfig = JSON.stringify(config);
        console.log('ConfigStorage: Saving config:', stringifiedConfig);
        await this.state.storage.put('config', stringifiedConfig);

        return new Response(JSON.stringify({ message: 'Config saved', config }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (error) {
        console.error('ConfigStorage: Error saving config:', error);
        return new Response(JSON.stringify({ error: 'Failed to save configuration' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
