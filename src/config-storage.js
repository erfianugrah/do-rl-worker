export class ConfigStorage {
  constructor(state, env) {
    this.state = state;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;

    console.log(`ConfigStorage: Received ${request.method} request for path: ${path}`);

    switch (request.method) {
      case 'GET':
        console.log('ConfigStorage: Handling GET request');
        return this.handleGet(path);
      case 'POST':
        console.log('ConfigStorage: Handling POST request');
        return this.handlePost(request);
      case 'PUT':
        console.log('ConfigStorage: Handling PUT request');
        return this.handlePut(request, path);
      case 'DELETE':
        console.log('ConfigStorage: Handling DELETE request');
        return this.handleDelete(path);
      default:
        console.log(`ConfigStorage: Method not allowed: ${request.method}`);
        return new Response(JSON.stringify({ error: 'Method not allowed' }), {
          status: 405,
          headers: { 'Content-Type': 'application/json' },
        });
    }
  }

  async handleGet(path) {
    console.log(`ConfigStorage: Handling GET request for path: ${path}`);
    if (path === '/config') {
      return this.getConfig();
    } else if (path.startsWith('/rules/')) {
      const ruleId = path.split('/')[2];
      return this.getRule(ruleId);
    }
    console.log(`ConfigStorage: GET request not found for path: ${path}`);
    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  async handlePost(request) {
    try {
      console.log('ConfigStorage: Handling POST request');
      let rule;
      const contentType = request.headers.get('Content-Type');

      if (contentType && contentType.includes('application/json')) {
        const text = await request.text();
        console.log('Received raw JSON:', text);
        rule = JSON.parse(text);
      } else {
        throw new Error('Unsupported Content-Type');
      }

      console.log('Parsed rule:', JSON.stringify(rule));

      if (!rule || typeof rule !== 'object') {
        throw new Error('Invalid rule data');
      }

      let rules = await this.state.storage.get('rules');
      console.log('Current rules from storage:', rules);

      if (rules === null || rules === undefined) {
        rules = [];
      } else if (typeof rules === 'string') {
        try {
          rules = JSON.parse(rules);
        } catch (e) {
          console.error('Error parsing existing rules:', e);
          rules = [];
        }
      }

      if (!Array.isArray(rules)) {
        console.warn('Rules in storage is not an array, resetting to empty array');
        rules = [];
      }

      rules.push(rule);
      console.log('Rules after adding new rule:', JSON.stringify(rules));

      await this.state.storage.put('rules', JSON.stringify(rules));
      console.log('Rules saved to storage');

      return new Response(JSON.stringify(rule), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      console.error('ConfigStorage: Error adding rule:', error);
      return new Response(JSON.stringify({ error: 'Failed to add rule', details: error.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  async handlePut(request, path) {
    console.log(`ConfigStorage: Handling PUT request for path: ${path}`);
    if (path === '/config/reorder') {
      console.log('ConfigStorage: Reordering rules');
      const { rules } = await request.json();
      if (!Array.isArray(rules)) {
        return new Response(JSON.stringify({ error: 'Invalid input: rules must be an array' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return this.reorderRules(rules);
    } else if (path.startsWith('/rules/')) {
      const ruleId = path.split('/')[2];
      console.log(`ConfigStorage: Updating rule with ID: ${ruleId}`);
      const rule = await request.json();
      return this.updateRule(ruleId, rule);
    }
    console.log(`ConfigStorage: PUT request not found for path: ${path}`);
    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  async handleDelete(path) {
    console.log(`ConfigStorage: Handling DELETE request for path: ${path}`);
    if (path.startsWith('/rules/')) {
      const ruleId = path.split('/')[2];
      console.log(`ConfigStorage: Deleting rule with ID: ${ruleId}`);
      return this.deleteRule(ruleId);
    }
    console.log(`ConfigStorage: DELETE request not found for path: ${path}`);
    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  async getConfig() {
    try {
      console.log('ConfigStorage: Getting config');
      let rules = await this.state.storage.get('rules');
      console.log('Raw rules from storage in getConfig:', rules);

      if (rules === null || rules === undefined) {
        rules = '[]';
      } else if (typeof rules !== 'string') {
        rules = JSON.stringify(rules);
      }

      console.log('Formatted rules in getConfig:', rules);

      // Parse and stringify again to ensure valid JSON
      const parsedRules = JSON.parse(rules);
      const formattedRules = JSON.stringify({ rules: parsedRules });

      return new Response(formattedRules, {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      console.error('ConfigStorage: Error retrieving rules:', error);
      return new Response(
        JSON.stringify({ error: 'Failed to retrieve rules', details: error.message }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }
  }

  async getRule(ruleId) {
    try {
      console.log(`ConfigStorage: Getting rule with ID: ${ruleId}`);
      const rules = JSON.parse((await this.state.storage.get('rules')) || '[]');
      const rule = rules.find((r) => r.id === ruleId);
      if (rule) {
        console.log(`ConfigStorage: Rule found: ${JSON.stringify(rule)}`);
        return new Response(JSON.stringify(rule), {
          headers: { 'Content-Type': 'application/json' },
        });
      }
      console.log(`ConfigStorage: Rule not found for ID: ${ruleId}`);
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

  async updateRule(ruleId, updatedRule) {
    try {
      console.log(`ConfigStorage: Updating rule with ID: ${ruleId}`);
      let rules = await this.state.storage.get('rules');
      console.log('Current rules before update:', rules);

      if (typeof rules === 'string') {
        rules = JSON.parse(rules);
      }

      const index = rules.findIndex((r) => r.id === ruleId);
      if (index !== -1) {
        rules[index] = updatedRule;
        await this.state.storage.put('rules', JSON.stringify(rules));
        console.log('Rules after update:', rules);
        return new Response(JSON.stringify({ message: 'Rule updated', rule: updatedRule }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      console.log(`ConfigStorage: Rule not found for ID: ${ruleId}`);
      return new Response(JSON.stringify({ error: 'Rule not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      console.error('ConfigStorage: Error updating rule:', error);
      return new Response(
        JSON.stringify({ error: 'Failed to update rule', details: error.message }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }
  }

  async deleteRule(ruleId) {
    try {
      console.log(`ConfigStorage: Deleting rule with ID: ${ruleId}`);
      let rules = await this.state.storage.get('rules');
      console.log('Current rules before delete:', rules);

      if (typeof rules === 'string') {
        rules = JSON.parse(rules);
      }

      const index = rules.findIndex((r) => r.id === ruleId);
      if (index !== -1) {
        rules.splice(index, 1);
        await this.state.storage.put('rules', JSON.stringify(rules));
        console.log('Rules after delete:', rules);
        return new Response(JSON.stringify({ message: 'Rule deleted' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      console.log(`ConfigStorage: Rule not found for ID: ${ruleId}`);
      return new Response(JSON.stringify({ error: 'Rule not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      console.error('ConfigStorage: Error deleting rule:', error);
      return new Response(
        JSON.stringify({ error: 'Failed to delete rule', details: error.message }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }
  }

  async reorderRules(updatedRules) {
    try {
      console.log('ConfigStorage: Reordering rules, received:', JSON.stringify(updatedRules));
      if (!Array.isArray(updatedRules)) {
        throw new Error('Invalid input: updatedRules must be an array');
      }
      await this.state.storage.put('rules', JSON.stringify(updatedRules));
      console.log('Rules after reordering:', JSON.stringify(updatedRules));
      return new Response(JSON.stringify({ message: 'Rules reordered', rules: updatedRules }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      console.error('ConfigStorage: Error reordering rules:', error);
      return new Response(
        JSON.stringify({ error: 'Failed to reorder rules', details: error.message }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }
  }
}
