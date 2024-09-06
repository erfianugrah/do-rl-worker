export const config = {
  // Rate limiting configuration
  rateLimit: {
    limit: 1,
    period: 1, // in seconds
  },

  // Request matching configuration
  requestMatch: {
    hostname: 'httpbun-nl.erfianugrah.com',
    path: '/headers', // Set to null or "" to match all paths
  },

  // Fingerprint configuration
  fingerprint: {
    // Baseline components (these will always be included)
    baseline: ['cf.tlsVersion', 'cf.tlsCipher', 'cf.ja4', 'clientIP'],

    // Additional components (can be easily modified)
    additional: ['cf.asn', 'user-agent', 'cf-device-type'],
  },

  // Static pages configuration
  staticPages: {
    rateLimitInfoPath: '/_ratelimit',
  },
};

// Helper function to update config
export function updateConfig(newConfig) {
  // Deep merge the new config with the existing config
  return deepMerge(config, newConfig);
}

// Helper function for deep merging objects
function deepMerge(target, source) {
  const output = Object.assign({}, target);
  if (isObject(target) && isObject(source)) {
    Object.keys(source).forEach((key) => {
      if (isObject(source[key])) {
        if (!(key in target)) Object.assign(output, { [key]: source[key] });
        else output[key] = deepMerge(target[key], source[key]);
      } else {
        Object.assign(output, { [key]: source[key] });
      }
    });
  }
  return output;
}

function isObject(item) {
  return item && typeof item === 'object' && !Array.isArray(item);
}
