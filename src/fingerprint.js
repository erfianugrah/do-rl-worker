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

    return await hashValue(body);
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

export async function generateFingerprint(request, env, fingerprintConfig, cfData) {
  console.log('Generating fingerprint with config:', JSON.stringify(fingerprintConfig, null, 2));
  console.log('Fingerprint: CF object:', JSON.stringify(cfData, null, 2));

  const clientIP = cfData.clientIp || request.headers.get('CF-Connecting-IP') || 'unknown';
  const timestamp = Math.floor(Date.now() / 1000);

  const parameters = fingerprintConfig.parameters || ['clientIP'];

  const parameterHandlers = {
    clientIP: () => clientIP,
    method: () => request.method,
    url: (param) => {
      if (param === 'url') return request.url;
      const url = new URL(request.url);
      return getNestedValue(url, param.slice(4));
    },
    body: () => getRequestBody(request),
    cf: (param) => getNestedValue(cfData, param.slice(3)),
    headers: (param) => request.headers.get(param.slice(8)),
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

  if (!parameters.includes('clientIP')) {
    components.unshift(clientIP);
    console.log('Added clientIP to fingerprint components:', clientIP);
  }

  components.push(timestamp.toString());
  console.log('Added timestamp to fingerprint components:', timestamp);

  console.log('Final fingerprint components:', components);

  const fingerprint = await hashValue(components.join('|'));
  console.log('Generated fingerprint:', fingerprint);
  return fingerprint;
}
