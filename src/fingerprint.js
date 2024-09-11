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
  return path.split('.').reduce((current, key) => {
    if (current && typeof current === 'object' && key in current) {
      return current[key];
    }
    return undefined;
  }, obj);
}

function getClientIP(request) {
  return (
    request.headers.get('CF-Connecting-IP') ||
    request.headers.get('True-Client-IP') ||
    request.headers.get('X-Forwarded-For')?.split(',')[0].trim() ||
    'unknown'
  );
}

export async function generateFingerprint(request, env, fingerprintConfig, originalCfData) {
  console.log('Generating fingerprint with config:', JSON.stringify(fingerprintConfig, null, 2));

  console.log('Fingerprint: Original CF object:', JSON.stringify(originalCfData, null, 2));

  const clientIP = getClientIP(request);
  const timestamp = Math.floor(Date.now() / 1000);

  const parameters = fingerprintConfig.parameters || ['clientIP'];

  const components = await Promise.all(
    parameters.map(async (param) => {
      let value;

      if (param.startsWith('cf.')) {
        value = getNestedValue(originalCfData, param.slice(3));
        if (value === undefined) {
          console.warn(`CF property not available for parameter: ${param}`);
        }
      } else if (param.startsWith('headers.')) {
        value = request.headers.get(param.slice(8));
      } else if (param.startsWith('url.')) {
        const url = new URL(request.url);
        value = getNestedValue(url, param.slice(4));
      } else if (param === 'method') {
        value = request.method;
      } else if (param === 'url') {
        value = request.url;
      } else if (param === 'body') {
        value = await getRequestBody(request);
      } else if (param === 'clientIP') {
        value = clientIP;
      } else {
        value = getNestedValue(request, param);
      }

      console.log(`Fingerprint parameter ${param}:`, value !== undefined ? value : '(undefined)');
      return value !== undefined && value !== null ? value.toString() : '';
    })
  );

  // Ensure clientIP is always included
  if (!components.includes(clientIP)) {
    components.unshift(clientIP);
    console.log('Added clientIP to fingerprint components:', clientIP);
  }

  // Add timestamp
  components.push(timestamp.toString());
  console.log('Added timestamp to fingerprint components:', timestamp);

  console.log('Final fingerprint components:', components);

  const fingerprint = await hashValue(components.join('|'));
  console.log('Generated fingerprint:', fingerprint);
  return fingerprint;
}
