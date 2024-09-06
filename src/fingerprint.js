import { hashValue } from './utils.js';
import { config } from './config.js';

export async function generateFingerprint(request, env) {
  const cf = request.cf;
  const clientIP = request.headers.get('CF-Connecting-IP') || '';
  const timestamp = Math.floor(Date.now() / 1000); // Current time in seconds

  // Gather baseline components
  const baselineComponents = config.fingerprint.baseline.map((param) => {
    if (param === 'clientIP') return clientIP;
    if (param.startsWith('cf.')) return cf[param.split('.')[1]] || '';
    return request.headers.get(param) || '';
  });

  // Gather additional components
  const additionalComponents = config.fingerprint.additional.map((param) => {
    if (param.startsWith('cf.')) return cf[param.split('.')[1]] || '';
    return request.headers.get(param) || '';
  });

  // Combine all components
  const allComponents = [...baselineComponents, ...additionalComponents, timestamp.toString()];

  // Generate the fingerprint
  return await hashValue(allComponents.join('|'));
}
