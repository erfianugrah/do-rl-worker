export class ConfigStorage {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.VERSION_LIMIT = 10;
    console.log(
      "ConfigStorage: Initialized with VERSION_LIMIT:",
      this.VERSION_LIMIT,
    );
  }

  async fetch(request) {
    const startTime = Date.now();
    const url = new URL(request.url);
    const path = url.pathname;

    console.log(
      `ConfigStorage: Received ${request.method} request for path: ${path}`,
    );

    let response;
    try {
      switch (request.method) {
        case "GET":
          console.log("ConfigStorage: Handling GET request");
          response = await this.handleGet(path);
          break;
        case "POST":
          console.log("ConfigStorage: Handling POST request");
          response = await this.handlePost(request);
          break;
        case "PUT":
          console.log("ConfigStorage: Handling PUT request");
          response = await this.handlePut(request, path);
          break;
        case "DELETE":
          console.log("ConfigStorage: Handling DELETE request");
          response = await this.handleDelete(path);
          break;
        default:
          console.log(`ConfigStorage: Method not allowed: ${request.method}`);
          response = new Response(
            JSON.stringify({ error: "Method not allowed" }),
            {
              status: 405,
              headers: { "Content-Type": "application/json" },
            },
          );
      }
    } catch (error) {
      console.error("ConfigStorage: Error handling request:", error);
      response = new Response(
        JSON.stringify({ error: "Internal server error" }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    const endTime = Date.now();
    console.log(
      `ConfigStorage: fetch took ${endTime - startTime}ms for ${request.url}`,
    );
    return response;
  }

  async handleGet(path) {
    console.log(`ConfigStorage: Handling GET request for path: ${path}`);
    if (path === "/config") {
      return this.getConfig();
    } else if (path.startsWith("/rules/")) {
      const ruleId = path.split("/")[2];
      return this.getRule(ruleId);
    } else if (path.startsWith("/versions/")) {
      const ruleId = path.split("/")[2];
      return this.getRuleVersions(ruleId);
    }
    console.log(`ConfigStorage: GET request not found for path: ${path}`);
    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  async handlePost(request) {
    try {
      console.log("ConfigStorage: Handling POST request");
      let rule = await request.json();
      console.log("Received rule:", this.safeStringify(rule));

      if (!this.isValidRuleStructure(rule)) {
        console.log("Invalid rule structure received");
        throw new Error("Invalid rule structure");
      }

      let rules = (await this.state.storage.get("rules")) || [];
      console.log("Current rules from storage:", this.safeStringify(rules));

      if (typeof rules === "string") {
        rules = JSON.parse(rules);
        console.log("Parsed rules from storage:", this.safeStringify(rules));
      }

      rule.version = 0;
      rule.order = rules.length;
      rules.push(rule);

      console.log("Updated rules array:", this.safeStringify(rules));

      await this.state.storage.put("rules", JSON.stringify(rules));
      console.log("Rules saved to storage");

      const versions = [
        {
          version: 0,
          timestamp: new Date().toISOString(),
          changes: ["Initial version"],
          data: JSON.parse(JSON.stringify(rule)),
        },
      ];
      console.log(
        `Versions for new rule ${rule.id}:`,
        this.safeStringify(versions),
      );

      await this.state.storage.put(
        `versions_${rule.id}`,
        JSON.stringify(versions),
      );
      console.log(`Versions saved for rule ${rule.id}`);

      return new Response(JSON.stringify(rule), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      console.error("ConfigStorage: Error adding rule:", error);
      return new Response(
        JSON.stringify({ error: "Failed to add rule", details: error.message }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
  }

  async handlePut(request, path) {
    console.log(`ConfigStorage: Handling PUT request for path: ${path}`);
    if (path === "/config/reorder") {
      console.log("ConfigStorage: Reordering rules");
      const { rules } = await request.json();
      return this.reorderRules(rules);
    } else if (path.startsWith("/rules/")) {
      const parts = path.split("/");
      const ruleId = parts[2];
      if (parts[3] === "revert") {
        console.log(`ConfigStorage: Reverting rule with ID: ${ruleId}`);
        const { targetVersion } = await request.json();
        return this.revertRule(ruleId, targetVersion);
      } else {
        console.log(`ConfigStorage: Updating rule with ID: ${ruleId}`);
        const rule = await request.json();
        return this.updateRule(ruleId, rule);
      }
    }
    console.log(`ConfigStorage: PUT request not found for path: ${path}`);
    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  async handleDelete(path) {
    console.log(`ConfigStorage: Handling DELETE request for path: ${path}`);
    if (path.startsWith("/rules/")) {
      const ruleId = path.split("/")[2];
      console.log(`ConfigStorage: Deleting rule with ID: ${ruleId}`);
      return this.deleteRule(ruleId);
    }
    console.log(`ConfigStorage: DELETE request not found for path: ${path}`);
    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  async getConfig() {
    try {
      console.log("ConfigStorage: Getting config");
      let rules = await this.state.storage.get("rules");
      console.log("Raw rules from storage:", this.safeStringify(rules));

      if (rules === null || rules === undefined) {
        console.log("No rules found in storage, initializing empty array");
        rules = "[]";
      } else if (typeof rules !== "string") {
        console.log("Rules in storage is not a string, stringifying");
        rules = JSON.stringify(rules);
      }

      const parsedRules = JSON.parse(rules);
      console.log("Parsed rules:", this.safeStringify(parsedRules));

      return new Response(JSON.stringify({ rules: parsedRules }), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      console.error("ConfigStorage: Error retrieving rules:", error);
      return new Response(
        JSON.stringify({
          error: "Failed to retrieve rules",
          details: error.message,
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
  }

  async getRule(ruleId) {
    try {
      console.log(`ConfigStorage: Getting rule with ID: ${ruleId}`);
      const rules = JSON.parse((await this.state.storage.get("rules")) || "[]");
      console.log("All rules:", this.safeStringify(rules));

      const rule = rules.find((r) => r.id === ruleId);
      if (rule) {
        console.log(`ConfigStorage: Rule found:`, this.safeStringify(rule));
        return new Response(JSON.stringify(rule), {
          headers: { "Content-Type": "application/json" },
        });
      }
      console.log(`ConfigStorage: Rule not found for ID: ${ruleId}`);
      return new Response(JSON.stringify({ error: "Rule not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      console.error("ConfigStorage: Error retrieving rule:", error);
      return new Response(
        JSON.stringify({
          error: "Failed to retrieve rule",
          details: error.message,
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
  }

  async getRuleVersions(ruleId) {
    try {
      console.log(
        `ConfigStorage: Getting versions for rule with ID: ${ruleId}`,
      );
      const versions = JSON.parse(
        (await this.state.storage.get(`versions_${ruleId}`)) || "[]",
      );
      console.log(`Versions for rule ${ruleId}:`, this.safeStringify(versions));

      if (versions.length > 0) {
        return new Response(JSON.stringify({ versions }), {
          headers: { "Content-Type": "application/json" },
        });
      }
      console.log(`ConfigStorage: No versions found for rule ID: ${ruleId}`);
      return new Response(JSON.stringify({ error: "No versions found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      console.error("ConfigStorage: Error retrieving rule versions:", error);
      return new Response(
        JSON.stringify({
          error: "Failed to retrieve rule versions",
          details: error.message,
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
  }

  async updateRule(ruleId, updatedRule) {
    try {
      console.log(`ConfigStorage: Updating rule with ID: ${ruleId}`);
      console.log("Received updated rule:", this.safeStringify(updatedRule));

      let rules = await this.state.storage.get("rules");
      console.log("Current rules from storage (raw):", rules);
      console.log("Current rules before update:", this.safeStringify(rules));

      if (typeof rules === "string") {
        rules = JSON.parse(rules);
      }

      console.log("Parsed current rules:", this.safeStringify(rules));

      const index = rules.findIndex((r) => r.id === ruleId);
      if (index !== -1) {
        if (!this.isValidRuleStructure(updatedRule)) {
          console.log("Invalid rule structure received");
          throw new Error("Invalid rule structure");
        }
        const oldRule = rules[index];
        console.log("Old rule:", this.safeStringify(oldRule));

        const newVersion = oldRule.version + 1;

        const newRule = {
          ...oldRule,
          ...updatedRule,
          id: oldRule.id,
          order: oldRule.order,
          version: newVersion,
          rateLimit: { ...oldRule.rateLimit, ...updatedRule.rateLimit },
          fingerprint: {
            parameters: [
              ...(updatedRule.fingerprint?.parameters ||
                oldRule.fingerprint.parameters),
            ],
          },
          initialMatch: {
            ...oldRule.initialMatch,
            ...updatedRule.initialMatch,
            conditions: [
              ...(updatedRule.initialMatch?.conditions ||
                oldRule.initialMatch.conditions),
            ],
            action: {
              ...oldRule.initialMatch.action,
              ...updatedRule.initialMatch?.action,
            },
          },
          elseIfActions: [
            ...(updatedRule.elseIfActions || oldRule.elseIfActions),
          ],
          elseAction: updatedRule.elseAction || oldRule.elseAction,
        };

        console.log("New rule after merging:", this.safeStringify(newRule));

        rules[index] = newRule;

        console.log("Updated rules array:", this.safeStringify(rules));

        const stringifiedRules = JSON.stringify(rules);
        console.log("Stringified rules to be stored:", stringifiedRules);

        await this.state.storage.put("rules", stringifiedRules);
        console.log("Rules saved to storage");

        // Verify that the rules were saved correctly
        const savedRules = await this.state.storage.get("rules");
        console.log("Saved rules (raw):", savedRules);
        console.log(
          "Saved rules (parsed):",
          this.safeStringify(JSON.parse(savedRules)),
        );

        let versions = JSON.parse(
          (await this.state.storage.get(`versions_${ruleId}`)) || "[]",
        );
        console.log("Current versions:", this.safeStringify(versions));

        versions.push({
          version: newVersion,
          timestamp: new Date().toISOString(),
          changes: ["Rule updated"],
          data: JSON.parse(JSON.stringify(newRule)),
        });

        if (versions.length > this.VERSION_LIMIT) {
          console.log(
            `Removing oldest version. Current count: ${versions.length}, Limit: ${this.VERSION_LIMIT}`,
          );
          versions.shift(); // Remove the oldest version
        }

        const stringifiedVersions = JSON.stringify(versions);
        console.log("Stringified versions to be stored:", stringifiedVersions);

        await this.state.storage.put(`versions_${ruleId}`, stringifiedVersions);
        console.log("Versions saved to storage");

        // Verify that the versions were saved correctly
        const savedVersions = await this.state.storage.get(
          `versions_${ruleId}`,
        );
        console.log("Saved versions (raw):", savedVersions);
        console.log(
          "Saved versions (parsed):",
          this.safeStringify(JSON.parse(savedVersions)),
        );

        console.log("Rule update complete");

        return new Response(
          JSON.stringify({ message: "Rule updated", rule: newRule }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      }
      console.log(`ConfigStorage: Rule not found for ID: ${ruleId}`);
      return new Response(JSON.stringify({ error: "Rule not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      console.error("ConfigStorage: Error updating rule:", error);
      return new Response(
        JSON.stringify({
          error: "Failed to update rule",
          details: error.message,
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
  }

  async deleteRule(ruleId) {
    try {
      console.log(`ConfigStorage: Deleting rule with ID: ${ruleId}`);
      let rules = await this.state.storage.get("rules");
      console.log("Current rules before delete:", this.safeStringify(rules));

      if (typeof rules === "string") {
        rules = JSON.parse(rules);
      }

      const index = rules.findIndex((r) => r.id === ruleId);
      if (index !== -1) {
        rules.splice(index, 1);
        console.log("Rules after delete:", this.safeStringify(rules));

        await this.state.storage.put("rules", JSON.stringify(rules));
        console.log("Updated rules saved to storage");

        await this.state.storage.delete(`versions_${ruleId}`);
        console.log(`Versions for rule ${ruleId} deleted`);

        return new Response(JSON.stringify({ message: "Rule deleted" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      console.log(`ConfigStorage: Rule not found for ID: ${ruleId}`);
      return new Response(JSON.stringify({ error: "Rule not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      console.error("ConfigStorage: Error deleting rule:", error);
      return new Response(
        JSON.stringify({
          error: "Failed to delete rule",
          details: error.message,
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
  }

  async reorderRules(updatedRules) {
    try {
      console.log(
        "ConfigStorage: Reordering rules, received:",
        this.safeStringify(updatedRules),
      );
      if (!Array.isArray(updatedRules)) {
        throw new Error("Invalid input: updatedRules must be an array");
      }
      if (!this.areValidRules(updatedRules)) {
        throw new Error("Invalid rule structure in the updated rules");
      }

      const reorderedRules = updatedRules.map((rule, index) => ({
        ...rule,
        order: index,
      }));

      console.log("Reordered rules:", this.safeStringify(reorderedRules));

      await this.state.storage.put("rules", JSON.stringify(reorderedRules));
      console.log("Reordered rules saved to storage");

      return new Response(
        JSON.stringify({ message: "Rules reordered", rules: reorderedRules }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    } catch (error) {
      console.error("ConfigStorage: Error reordering rules:", error);
      return new Response(
        JSON.stringify({
          error: "Failed to reorder rules",
          details: error.message,
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
  }

  async revertRule(ruleId, targetVersion) {
    try {
      console.log(
        `ConfigStorage: Reverting rule ${ruleId} to version ${targetVersion}`,
      );
      let rules = await this.state.storage.get("rules");
      console.log("Current rules before revert:", this.safeStringify(rules));

      if (typeof rules === "string") {
        rules = JSON.parse(rules);
      }

      const ruleIndex = rules.findIndex((r) => r.id === ruleId);
      if (ruleIndex === -1) {
        console.log(`Rule not found for ID: ${ruleId}`);
        throw new Error("Rule not found");
      }

      const currentRule = rules[ruleIndex];
      console.log("Current rule:", this.safeStringify(currentRule));

      const versions = JSON.parse(
        (await this.state.storage.get(`versions_${ruleId}`)) || "[]",
      );
      console.log("All versions for the rule:", this.safeStringify(versions));

      const targetVersionData = versions.find((v) =>
        v.version === targetVersion
      );

      if (!targetVersionData) {
        console.log(`Target version ${targetVersion} not found in history`);
        throw new Error("Target version not found in history");
      }

      console.log(
        "Target version data:",
        this.safeStringify(targetVersionData),
      );

      const revertedRule = {
        ...targetVersionData.data,
        version: currentRule.version + 1,
        order: currentRule.order,
      };
      console.log("Reverted rule:", this.safeStringify(revertedRule));

      rules[ruleIndex] = revertedRule;
      console.log("Updated rules array:", this.safeStringify(rules));

      await this.state.storage.put("rules", JSON.stringify(rules));
      console.log("Updated rules saved to storage");

      versions.push({
        version: revertedRule.version,
        timestamp: new Date().toISOString(),
        changes: [`Reverted to version ${targetVersion}`],
        data: JSON.parse(JSON.stringify(revertedRule)),
      });

      if (versions.length > this.VERSION_LIMIT) {
        console.log(
          `Removing oldest version. Current count: ${versions.length}, Limit: ${this.VERSION_LIMIT}`,
        );
        versions.shift(); // Remove the oldest version
      }

      console.log("Updated versions array:", this.safeStringify(versions));

      await this.state.storage.put(
        `versions_${ruleId}`,
        JSON.stringify(versions),
      );
      console.log("Updated versions saved to storage");

      return new Response(
        JSON.stringify({ message: "Rule reverted", rule: revertedRule }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    } catch (error) {
      console.error("ConfigStorage: Error reverting rule:", error);
      return new Response(
        JSON.stringify({
          error: "Failed to revert rule",
          details: error.message,
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
  }

  isValidRuleStructure(rule) {
    const isValid = rule &&
      typeof rule === "object" &&
      typeof rule.id === "string" &&
      typeof rule.name === "string" &&
      typeof rule.description === "string" &&
      typeof rule.rateLimit === "object" &&
      typeof rule.rateLimit.limit === "number" &&
      typeof rule.rateLimit.period === "number" &&
      typeof rule.fingerprint === "object" &&
      Array.isArray(rule.fingerprint.parameters) &&
      typeof rule.initialMatch === "object" &&
      Array.isArray(rule.initialMatch.conditions) &&
      typeof rule.initialMatch.action === "object" &&
      Array.isArray(rule.elseIfActions) &&
      (!rule.elseAction || typeof rule.elseAction === "object");

    console.log(`Rule structure validation result: ${isValid}`);
    if (!isValid) {
      console.log("Invalid rule structure:", this.safeStringify(rule));
    }

    return isValid;
  }

  areValidRules(rules) {
    const isValid = Array.isArray(rules) &&
      rules.every((rule) => this.isValidRuleStructure(rule));
    console.log(`Rules array validation result: ${isValid}`);
    return isValid;
  }

  safeStringify(obj, indent = 2) {
    let cache = [];
    const retVal = JSON.stringify(
      obj,
      (key, value) =>
        typeof value === "object" && value !== null
          ? cache.includes(value)
            ? undefined // Duplicate reference found, discard key
            : cache.push(value) && value // Store value in our collection
          : value,
      indent,
    );
    cache = null;
    return retVal;
  }
}
