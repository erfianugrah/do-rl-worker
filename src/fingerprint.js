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

const getNestedValue = (obj, path) =>
  path.split('.').reduce((current, part) => current && current[part], obj);

const getClientIP = (request, cfData) => {
  console.log('Debug: cfData:', JSON.stringify(cfData, null, 2));
  console.log('Debug: All headers:', JSON.stringify(Object.fromEntries(request.headers)));

  const ipSources = [
    () => request.headers.get('true-client-ip'),
    () => request.headers.get('cf-connecting-ip'),
    () => request.headers.get('x-forwarded-for')?.split(',')[0].trim(),
    () => cfData.clientIp,
  ];

  for (const source of ipSources) {
    const ip = source();
    if (ip) {
      console.log(`Debug: IP found: ${ip}`);
      return ip;
    }
  }

  console.warn('Unable to determine client IP from request or CF data');
  return 'unknown';
};

const extractHeaderNameValue = (request, param) =>
  param.headerName &&
  param.headerValue &&
  request.headers.get(param.headerName) === param.headerValue
    ? `${param.headerName}:${param.headerValue}`
    : null;

const extractBodyField = (bodyContent, fieldPath) => {
  try {
    const jsonBody = JSON.parse(bodyContent);
    return getNestedValue(jsonBody, fieldPath) || '';
  } catch (error) {
    console.log('Body is not JSON, treating as plain text');
    return bodyContent;
  }
};

const parameterExtractors = {
  'headers.nameValue': (request, param) => extractHeaderNameValue(request, param),
  headers: (request, param) => request.headers.get(param.name.slice(8)),
  url: (request, param) => getNestedValue(new URL(request.url), param.name.slice(4)),
  queryParam: (request, param) => new URL(request.url).searchParams.get(param.queryParamName) || '',
  cf: (request, param, cfData) => getNestedValue(cfData, param.name.slice(3)),
  clientIP: (request, param, cfData) => getClientIP(request, cfData),
  method: (request) => request.method,
  body: async (request, param) => {
    const bodyContent = await getRequestBody(request);
    return param.name === 'body' ? bodyContent : extractBodyField(bodyContent, param.name.slice(5));
  },
};

export async function generateFingerprint(request, env, fingerprintConfig, cfData) {
  console.log('Generating fingerprint with config:', JSON.stringify(fingerprintConfig, null, 2));
  console.log('Fingerprint: CF object:', JSON.stringify(cfData, null, 2));

  const timestamp = Math.floor(Date.now() / 1000);
  const parameters = fingerprintConfig.parameters || ['clientIP'];

  const components = await Promise.all(
    parameters.map(async (param) => {
      const extractorKey = Object.keys(parameterExtractors).find((key) =>
        param.name.startsWith(key)
      );
      const extractor = parameterExtractors[extractorKey];

      if (!extractor) {
        console.warn(`Unsupported fingerprint parameter: ${param.name}`);
        return '';
      }

      const value = await extractor(request, param, cfData);
      console.log(
        `Fingerprint parameter ${param.name}:`,
        value !== undefined ? value : '(undefined)'
      );
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
