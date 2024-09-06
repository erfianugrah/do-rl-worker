import { hashValue } from './utils.js';

export async function generateFingerprint(request, env, fingerprintConfig) {
  console.log('Generating fingerprint with config:', JSON.stringify(fingerprintConfig, null, 2));

  const cf = request.cf || {};
  const clientIP = request.headers.get('CF-Connecting-IP') || '';
  const timestamp = Math.floor(Date.now() / 1000); // Current time in seconds

  // Gather baseline components
  const baselineComponents = fingerprintConfig.baseline.map((param) => {
    if (param === 'clientIP') return clientIP;
    if (param.startsWith('cf.')) return cf[param.split('.')[1]] || '';
    return request.headers.get(param) || '';
  });

  // Gather additional components
  const additionalComponents = fingerprintConfig.additional.map((param) => {
    if (param.startsWith('cf.')) return cf[param.split('.')[1]] || '';
    return request.headers.get(param) || '';
  });

  // Combine all components
  const allComponents = [...baselineComponents, ...additionalComponents, timestamp.toString()];

  console.log('Fingerprint components:', allComponents);

  // Generate the fingerprint
  return await hashValue(allComponents.join('|'));
}
