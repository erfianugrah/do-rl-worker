// ConfigStorage Durable Object
export class ConfigStorage {
  constructor(state, env) {
    this.state = state;
  }

  async fetch(request) {
    if (request.method === 'GET') {
      const config = await this.state.storage.get('config');
      return new Response(config || '{"rules":[]}', {
        headers: { 'Content-Type': 'application/json' },
      });
    } else if (request.method === 'POST') {
      const config = await request.json();
      await this.state.storage.put('config', JSON.stringify(config));
      return new Response('Config saved', { status: 200 });
    }
    return new Response('Method not allowed', { status: 405 });
  }
}
