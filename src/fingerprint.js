import { hashValue } from './utils.js';

const BODY_SIZE_LIMIT = 524288; // 512 KB in bytes

const parameterFunctions = {
  clientIP: (request) => request.headers.get('CF-Connecting-IP') || '',
  'headers.user-agent': (request) => request.headers.get('User-Agent') || '',
  'headers.accept-language': (request) => request.headers.get('Accept-Language') || '',
  'headers.accept-encoding': (request) => request.headers.get('Accept-Encoding') || '',
  'headers.sec-fetch-dest': (request) => request.headers.get('Sec-Fetch-Dest') || '',
  'headers.sec-fetch-mode': (request) => request.headers.get('Sec-Fetch-Mode') || '',
  'headers.sec-fetch-site': (request) => request.headers.get('Sec-Fetch-Site') || '',
  'headers.sec-fetch-user': (request) => request.headers.get('Sec-Fetch-User') || '',
  'url.hostname': (request) => new URL(request.url).hostname,
  body: async (request) => {
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
  },
  'cf.asn': (request) => request.cf?.asn?.toString() || '',
  'cf.httpProtocol': (request) => request.cf?.httpProtocol || '',
  'cf.tlsVersion': (request) => request.cf?.tlsVersion || '',
  'cf.tlsCipher': (request) => request.cf?.tlsCipher || '',
  'cf.clientTrustScore': (request) => request.cf?.clientTrustScore?.toString() || '',
  'cf.botManagement.score': (request) => request.cf?.botManagement?.score?.toString() || '',
  'cf.botManagement.ja3Hash': (request) => request.cf?.botManagement?.ja3Hash || '',
  'cf.botManagement.ja4': (request) => request.cf?.botManagement?.ja4 || '',
  'cf.clientAcceptEncoding': (request) => request.cf?.clientAcceptEncoding || '',
  'cf.country': (request) => request.cf?.country || '',
  'cf.city': (request) => request.cf?.city || '',
  'cf.continent': (request) => request.cf?.continent || '',
  'cf.latitude': (request) => request.cf?.latitude?.toString() || '',
  'cf.longitude': (request) => request.cf?.longitude?.toString() || '',
  'cf.postalCode': (request) => request.cf?.postalCode || '',
  'cf.region': (request) => request.cf?.region || '',
  'cf.regionCode': (request) => request.cf?.regionCode || '',
  'cf.timezone': (request) => request.cf?.timezone || '',
  'cf.tlsClientHelloLength': (request) => request.cf?.tlsClientHelloLength?.toString() || '',
  'cf.tlsExportedAuthenticator.clientHandshake': (request) =>
    request.cf?.tlsExportedAuthenticator?.clientHandshake || '',
  'cf.tlsExportedAuthenticator.clientFinished': (request) =>
    request.cf?.tlsExportedAuthenticator?.clientFinished || '',
};

export async function generateFingerprint(request, env, fingerprintConfig) {
  console.log('Generating fingerprint with config:', JSON.stringify(fingerprintConfig, null, 2));

  const clientIP = request.headers.get('CF-Connecting-IP') || '';
  const timestamp = Math.floor(Date.now() / 1000); // Current time in seconds

  const parameters = fingerprintConfig.parameters || ['clientIP'];

  const components = await Promise.all(
    parameters.map(async (param) => {
      if (param in parameterFunctions) {
        return await parameterFunctions[param](request);
      } else {
        console.warn(`Unknown fingerprint parameter: ${param}`);
        return '';
      }
    })
  );

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
