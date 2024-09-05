// RateLimitDO.js
import {
  hashValue,
  generateEncryptionKey,
  encryptData,
  decryptData,
  exportKey,
  importKey,
} from './utils.js';
import { serveRateLimitPage } from './staticpages.js';

export class RateLimitDO {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    const config = await this.getConfig();
    if (!config) {
      return new Response('Rate limit configuration not found', { status: 500 });
    }

    const clientId = await this.getClientId(request, config);
    const session = await this.getOrCreateSession(clientId, config);

    const currentTime = Date.now();
    const timePassed = Math.max(0, currentTime - session.lastRequest);
    const tokenRefillAmount = (timePassed / (config.refillTime * 1000)) * config.maxTokens;

    let newTokenCount = Math.min(session.tokens + tokenRefillAmount, config.maxTokens);

    console.log(
      `Before request - Tokens: ${newTokenCount.toFixed(2)}, Last request: ${new Date(session.lastRequest).toISOString()}`
    );

    if (newTokenCount < 1) {
      const cooldownEndTime = new Date(
        currentTime + (config.refillTime * 1000 * (1 - newTokenCount)) / config.maxTokens
      );
      return this.createRateLimitResponse(cooldownEndTime, request);
    }

    // Decrease token count for this request
    newTokenCount = Math.max(0, newTokenCount - 1);

    // Update session
    const updatedSession = {
      ...session,
      lastRequest: currentTime,
      tokens: newTokenCount,
    };
    await this.updateSession(clientId, updatedSession);

    console.log(
      `After request - Tokens: ${newTokenCount.toFixed(2)}, Last request: ${new Date(currentTime).toISOString()}`
    );

    // Continue with the original request
    return this.handleRequest(request, updatedSession, config);
  }

  async getConfig() {
    try {
      const configResponse = await this.env.CONFIGURATION_DO.fetch(
        new Request('https://rate-limiter-configurator/config', {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
        })
      );

      if (!configResponse.ok) {
        console.error(`Failed to fetch configuration: HTTP ${configResponse.status}`);
        const responseText = await configResponse.text();
        console.error(`Response body: ${responseText}`);
        return null;
      }

      const config = await configResponse.json();
      console.log('Fetched configuration:', JSON.stringify(config));
      return config;
    } catch (error) {
      console.error('Error fetching configuration:', error);
      return null;
    }
  }

  async getClientId(request, config) {
    const identifiers = [];
    if (config.useClientIp) identifiers.push(request.headers.get('CF-Connecting-IP'));
    if (config.useAsn) identifiers.push(request.cf.asn);
    if (config.useJa4) identifiers.push(request.cf.botManagement?.ja4 || '');
    if (config.useJa3) identifiers.push(request.cf.clientTLSFingerprint || '');
    if (config.headers && config.headers.length > 0) {
      config.headers.forEach((header) => identifiers.push(request.headers.get(header) || ''));
    }
    if (config.usePath) identifiers.push(new URL(request.url).pathname);
    if (config.useHostname) identifiers.push(request.headers.get('Host'));

    return await hashValue(identifiers.join('-'));
  }

  async getOrCreateSession(clientId, config) {
    let encryptedSession = await this.state.storage.get(clientId);

    if (!encryptedSession) {
      const session = {
        clientId,
        lastRequest: 0,
        tokens: config.maxTokens,
      };
      return session;
    } else {
      try {
        const { encryptedData, iv } = JSON.parse(encryptedSession);
        const key = await this.getEncryptionKey(clientId);
        const decryptedData = await decryptData(
          key,
          new Uint8Array(encryptedData),
          new Uint8Array(iv)
        );
        return JSON.parse(decryptedData);
      } catch (error) {
        console.error('Error decrypting session:', error);
        // If decryption fails, create a new session
        return {
          clientId,
          lastRequest: 0,
          tokens: config.maxTokens,
        };
      }
    }
  }

  async updateSession(clientId, session) {
    try {
      const key = await this.getEncryptionKey(clientId);
      const { encryptedData, iv } = await encryptData(key, JSON.stringify(session));
      await this.state.storage.put(
        clientId,
        JSON.stringify({
          encryptedData: Array.from(new Uint8Array(encryptedData)),
          iv: Array.from(iv),
        })
      );
    } catch (error) {
      console.error('Error updating session:', error);
    }
  }

  async getEncryptionKey(clientId) {
    let keyData = await this.state.storage.get(`key:${clientId}`);
    if (!keyData) {
      const newKey = await generateEncryptionKey();
      keyData = await exportKey(newKey);
      await this.state.storage.put(`key:${clientId}`, JSON.stringify(keyData));
    } else {
      keyData = JSON.parse(keyData);
    }
    return await importKey(keyData);
  }

  createRateLimitResponse(cooldownEndTime, request) {
    return serveRateLimitPage(cooldownEndTime, request);
  }

  handleRequest(request, session, config) {
    const currentTime = Date.now();
    const timeUntilReset = Math.max(
      0,
      (config.refillTime * 1000 * (config.maxTokens - session.tokens)) / config.maxTokens
    );
    const resetTime = new Date(currentTime + timeUntilReset);

    const headers = {
      'X-RateLimit-Limit': config.maxTokens.toString(),
      'X-RateLimit-Remaining': Math.floor(session.tokens).toString(),
      'X-RateLimit-Reset': resetTime.toUTCString(),
    };

    // Check if it's an API request
    // const acceptHeader = request.headers.get('Accept') || '';
    // if (acceptHeader.includes('application/json')) {
    //   return new Response(request.body, {
    //     headers: {
    //       ...headers,
    //       'Content-Type': 'application/json',
    //     },
    //   });
    // }

    // For non-API requests, you might want to modify this part based on your specific needs
    return new Response(request.body, request, {
      headers: { ...headers },
    });
  }
}
