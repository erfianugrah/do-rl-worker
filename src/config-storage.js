export class ConfigStorage {
  constructor(state, env) {
    this.state = state;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;

    switch (request.method) {
      case 'GET':
        return this.handleGet(path);
      case 'POST':
        return this.handlePost(request);
      case 'PUT':
        return this.handlePut(request, path);
      case 'DELETE':
        return this.handleDelete(path);
      default:
        return new Response(JSON.stringify({ error: 'Method not allowed' }), {
          status: 405,
          headers: { 'Content-Type': 'application/json' },
        });
    }
  }

  async handleGet(path) {
    if (path === '/config') {
      return this.getConfig();
    } else if (path.startsWith('/rules/')) {
      const ruleId = path.split('/')[2];
      return this.getRule(ruleId);
    }
    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  async handlePost(request) {
    const config = await request.json();
    return this.saveConfig(config);
  }

  async handlePut(request, path) {
    if (path === '/config/reorder') {
      const updatedRules = await request.json();
      return this.reorderRules(updatedRules);
    } else if (path.startsWith('/rules/')) {
      const ruleId = path.split('/')[2];
      const rule = await request.json();
      return this.updateRule(ruleId, rule);
    }
    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  async handleDelete(path) {
    if (path.startsWith('/rules/')) {
      const ruleId = path.split('/')[2];
      return this.deleteRule(ruleId);
    }
    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  async getConfig() {
    try {
      const config = await this.state.storage.get('config');
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
  }

  async getRule(ruleId) {
    try {
      const config = JSON.parse(
        (await this.state.storage.get('config')) || '{"version":"1.0","rules":[]}'
      );
      const rule = config.rules.find((r) => r.id === ruleId);
      if (rule) {
        return new Response(JSON.stringify(rule), {
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ error: 'Rule not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      console.error('ConfigStorage: Error retrieving rule:', error);
      return new Response(JSON.stringify({ error: 'Failed to retrieve rule' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  async saveConfig(config) {
    try {
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

  async updateRule(ruleId, updatedRule) {
    try {
      const config = JSON.parse(
        (await this.state.storage.get('config')) || '{"version":"1.0","rules":[]}'
      );
      const index = config.rules.findIndex((r) => r.id === ruleId);
      if (index !== -1) {
        config.rules[index] = updatedRule;
        await this.saveConfig(config);
        return new Response(JSON.stringify({ message: 'Rule updated', rule: updatedRule }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ error: 'Rule not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      console.error('ConfigStorage: Error updating rule:', error);
      return new Response(JSON.stringify({ error: 'Failed to update rule' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  async deleteRule(ruleId) {
    try {
      const config = JSON.parse(
        (await this.state.storage.get('config')) || '{"version":"1.0","rules":[]}'
      );
      const index = config.rules.findIndex((r) => r.id === ruleId);
      if (index !== -1) {
        config.rules.splice(index, 1);
        await this.saveConfig(config);
        return new Response(JSON.stringify({ message: 'Rule deleted' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ error: 'Rule not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      console.error('ConfigStorage: Error deleting rule:', error);
      return new Response(JSON.stringify({ error: 'Failed to delete rule' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  async reorderRules(updatedRules) {
    try {
      const config = JSON.parse(
        (await this.state.storage.get('config')) || '{"version":"1.0","rules":[]}'
      );
      config.rules = updatedRules;
      await this.saveConfig(config);
      return new Response(JSON.stringify({ message: 'Rules reordered', rules: updatedRules }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      console.error('ConfigStorage: Error reordering rules:', error);
      return new Response(JSON.stringify({ error: 'Failed to reorder rules' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }
}
