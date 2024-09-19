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
  return path.split('.').reduce((current, part) => current && current[part], obj);
}

function getClientIP(request, cfData) {
  return (
    request.headers.get('true-client-ip') ||
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    cfData.clientIp ||
    'unknown'
  );
}

export async function generateFingerprint(request, env, fingerprintConfig, cfData) {
  console.log('Generating fingerprint with config:', JSON.stringify(fingerprintConfig, null, 2));
  console.log('Fingerprint: CF object:', JSON.stringify(cfData, null, 2));

  const timestamp = Math.floor(Date.now() / 1000);
  const parameters = fingerprintConfig.parameters || ['clientIP'];

  const components = await Promise.all(
    parameters.map(async (param) => {
      let value;
      if (param.startsWith('headers.')) {
        value = request.headers.get(param.slice(8));
      } else if (param.startsWith('url.')) {
        const url = new URL(request.url);
        value = getNestedValue(url, param.slice(4));
      } else if (param.startsWith('cf.')) {
        value = getNestedValue(cfData, param.slice(3));
      } else if (param === 'clientIP') {
        value = getClientIP(request, cfData);
      } else if (param === 'method') {
        value = request.method;
      } else if (param === 'url') {
        value = request.url;
      } else if (param === 'body' || param.startsWith('body.')) {
        const bodyContent = await getRequestBody(request);
        value = param === 'body' ? bodyContent : extractBodyField(bodyContent, param.slice(5));
      } else {
        console.warn(`Unsupported fingerprint parameter: ${param}`);
        return '';
      }

      console.log(`Fingerprint parameter ${param}:`, value !== undefined ? value : '(undefined)');
      return value !== undefined && value !== null ? value.toString() : '';
    })
  );

  components.push(timestamp.toString());
  console.log('Added timestamp to fingerprint components:', timestamp);
  console.log('Final fingerprint components:', components);

  const fingerprint = await hashValue(components.join('|'));
  console.log('Generated fingerprint:', fingerprint);
  return fingerprint;
}

function extractBodyField(bodyContent, fieldPath) {
  try {
    const jsonBody = JSON.parse(bodyContent);
    return getNestedValue(jsonBody, fieldPath) || '';
  } catch (error) {
    console.log('Body is not JSON, treating as plain text');
    return bodyContent;
  }
}
