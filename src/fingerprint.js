import { hashValue } from './utils.js';

export async function generateFingerprint(request, env, fingerprintConfig) {
  console.log('Generating fingerprint with config:', JSON.stringify(fingerprintConfig, null, 2));

  const cf = request.cf || {};
  const clientIP = request.headers.get('CF-Connecting-IP') || '';
  const timestamp = Math.floor(Date.now() / 1000); // Current time in seconds

  const parameters = fingerprintConfig.parameters || ['clientIP'];

  const components = parameters.map((param) => {
    switch (param) {
      case 'clientIP':
        return clientIP;
      case 'user-agent':
        return request.headers.get('User-Agent') || '';
      case 'cf-device-type':
        return request.headers.get('CF-Device-Type') || '';
      default:
        if (param.startsWith('cf.')) {
          const cfParam = param.split('.').slice(1);
          return cfParam.reduce((obj, key) => obj && obj[key], cf) || '';
        }
        return '';
    }
  });

  // Ensure clientIP is always included
  if (!components.includes(clientIP)) {
    components.unshift(clientIP);
  }

  // Add timestamp
  components.push(timestamp.toString());

  console.log('Fingerprint components:', components);

  // Generate the fingerprint
  return await hashValue(components.join('|'));
}
