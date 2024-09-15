// fingerprint.js

import { hashValue } from './utils.js';

const BODY_SIZE_LIMIT = 524288; // 512 KB in bytes

async function getRequestBody(request) {
  try {
    const clonedRequest = request.clone();
    const reader = clonedRequest.body.getReader();
    let body = '';
    let bytesRead = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = new TextDecoder().decode(value);
      bytesRead += value.length;

      if (bytesRead <= BODY_SIZE_LIMIT) {
        body += chunk;
      } else {
        body += chunk.slice(0, BODY_SIZE_LIMIT - (bytesRead - value.length));
        console.warn(
          `Request body exceeded ${BODY_SIZE_LIMIT} bytes for fingerprinting. Truncating.`
        );
        break;
      }
    }

    return body;
  } catch (error) {
    console.error('Error reading request body for fingerprinting:', error);
    return '';
  }
}

function getNestedValue(obj, path) {
  return path
    .split('.')
    .reduce(
      (current, key) =>
        current && typeof current === 'object' && key in current ? current[key] : undefined,
      obj
    );
}

function getClientIP(request, cfData) {
  if (cfData && cfData.clientIp) return cfData.clientIp;

  const cfConnectingIP = request.headers.get('CF-Connecting-IP');
  if (cfConnectingIP) return cfConnectingIP;

  const trueClientIP = request.headers.get('True-Client-IP');
  if (trueClientIP) return trueClientIP;

  const forwardedFor = request.headers.get('X-Forwarded-For');
  if (forwardedFor) {
    // X-Forwarded-For can contain multiple IPs; we want the first (original) one
    return forwardedFor.split(',')[0].trim();
  }

  return 'unknown';
}

export async function generateFingerprint(request, env, fingerprintConfig, cfData, bodyContent) {
  console.log('Generating fingerprint with config:', JSON.stringify(fingerprintConfig, null, 2));
  console.log('Fingerprint: CF object:', JSON.stringify(cfData, null, 2));

  // const clientIP = cfData.clientIp || request.headers.get('CF-Connecting-IP') || 'unknown';
  const timestamp = Math.floor(Date.now() / 1000);

  const parameters = fingerprintConfig.parameters || ['clientIP'];

  const parameterHandlers = {
    clientIP: () => getClientIP(request),
    method: () => request.method,
    url: (param) => {
      if (param === 'url') return request.url;
      const url = new URL(request.url);
      return getNestedValue(url, param.slice(4));
    },
    body: async (param) => {
      if (param === 'body') {
        return bodyContent;
      } else if (param.startsWith('body.custom:')) {
        const fieldPath = param.split(':')[1];
        return extractBodyField(bodyContent, fieldPath);
      }
    },
    cf: (param) => getNestedValue(cfData, param.slice(3)),
    headers: (param) => {
      if (param.startsWith('headers.name:')) {
        const headerName = param.split(':')[1];
        return request.headers.get(headerName) || '';
      } else if (param.startsWith('headers.nameValue:')) {
        const [, headerName, expectedValue] = param.split(':');
        const actualValue = request.headers.get(headerName);
        return actualValue === expectedValue ? `${headerName}:${actualValue}` : '';
      }
    },
  };

  const components = await Promise.all(
    parameters.map(async (param) => {
      let value;
      const [prefix, ...rest] = param.split('.');
      const handler = parameterHandlers[prefix];
      if (handler) {
        value = await handler(param);
      } else {
        value = getNestedValue(request, param);
      }

      console.log(`Fingerprint parameter ${param}:`, value !== undefined ? value : '(undefined)');
      return value !== undefined && value !== null ? value.toString() : '';
    })
  );

  // if (!parameters.includes('clientIP')) {
  //   components.unshift(clientIP);
  //   console.log('Added clientIP to fingerprint components:', clientIP);
  // }

  components.push(timestamp.toString());
  console.log('Added timestamp to fingerprint components:', timestamp);

  console.log('Final fingerprint components:', components);

  const fingerprint = await hashValue(components.join('|'));
  console.log('Generated fingerprint:', fingerprint);
  return fingerprint;
}

function extractBodyField(bodyContent, fieldPath) {
  // Try parsing as JSON first
  try {
    const jsonBody = JSON.parse(bodyContent);
    return getNestedValue(jsonBody, fieldPath) || '';
  } catch (error) {
    // If not JSON, treat as plain text or other format
    console.log('Body is not JSON, treating as plain text');
    // For non-JSON bodies, we can't extract nested fields, so return the whole body
    return bodyContent;
  }
}
