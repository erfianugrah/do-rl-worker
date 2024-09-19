const BODY_SIZE_LIMIT = 524288;

// CIDR matching function
function isIPInCIDR(ip, cidr) {
  const [range, bits = 32] = cidr.split('/');
  const mask = ~(2 ** (32 - bits) - 1);
  const ipInt = ip.split('.').reduce((int, oct) => (int << 8) + parseInt(oct, 10), 0) >>> 0;
  const rangeInt = range.split('.').reduce((int, oct) => (int << 8) + parseInt(oct, 10), 0) >>> 0;
  return (ipInt & mask) === (rangeInt & mask);
}

const fieldFunctions = {
  method: (request) => request.method,
  url: (request) => request.url,
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
          console.warn(`Request body exceeded ${BODY_SIZE_LIMIT} bytes. Truncating.`);
          break;
        }
      }

      return body;
    } catch (error) {
      console.error('Error reading request body:', error);
      return '';
    }
  },
  headers: (request, headerName) => {
    if (headerName) {
      return request.headers.get(headerName);
    }
    return JSON.stringify(Object.fromEntries(request.headers));
  },
  cf: (request, cfProperty) => {
    if (cfProperty) {
      const value = request.cf[cfProperty];
      return typeof value === 'object' ? JSON.stringify(value) : value?.toString();
    }
    return JSON.stringify(request.cf);
  },
  clientIP: (request) => {
    return (
      request.headers.get('true-client-ip') ||
      request.headers.get('cf-connecting-ip') ||
      request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
      request.cf.clientIp
    );
  },
};

const operatorFunctions = {
  eq: (a, b) => a === b,
  ne: (a, b) => a !== b,
  gt: (a, b) => parseFloat(a) > parseFloat(b),
  ge: (a, b) => parseFloat(a) >= parseFloat(b),
  lt: (a, b) => parseFloat(a) < parseFloat(b),
  le: (a, b) => parseFloat(a) <= parseFloat(b),
  contains: (a, b) => String(a).includes(b),
  notContains: (a, b) => !String(a).includes(b),
  startsWith: (a, b) => String(a).startsWith(b),
  endsWith: (a, b) => String(a).endsWith(b),
  regex: (a, b) => {
    try {
      const regex = new RegExp(b);
      return regex.test(String(a));
    } catch (error) {
      console.error('Invalid regex:', b, error);
      return false;
    }
  },
  inCIDR: (ip, cidr) => {
    try {
      return isIPInCIDR(ip, cidr);
    } catch (error) {
      console.error('Invalid CIDR or IP:', cidr, ip, error);
      return false;
    }
  },
};

export async function evaluateConditions(request, conditions, logic = 'and') {
  console.log(`Evaluating conditions with logic: ${logic}`);
  console.log(`Conditions:`, JSON.stringify(conditions, null, 2));

  if (!Array.isArray(conditions)) {
    console.warn('Invalid conditions structure');
    return false;
  }

  const results = await Promise.all(
    conditions.map(async (condition) => {
      if (condition.type === 'group') {
        return evaluateConditions(request, condition.conditions, condition.logic);
      } else if (condition.type === 'operator') {
        return condition.logic === 'or';
      } else {
        return evaluateCondition(request, condition);
      }
    })
  );

  if (logic === 'or') {
    return results.some((result) => result);
  } else {
    return results.every((result) => result);
  }
}

async function evaluateCondition(request, condition) {
  const { field, operator, value } = condition;
  let fieldFunction;
  let fieldValue;

  const [fieldType, fieldName] = field.split('.');

  if (fieldFunctions[fieldType]) {
    fieldFunction = (req) => fieldFunctions[fieldType](req, fieldName);
  } else {
    console.warn(`Invalid field: ${field}`);
    return false;
  }

  if (!operatorFunctions[operator]) {
    console.warn(`Invalid operator: ${operator}`);
    return false;
  }

  fieldValue = await fieldFunction(request);

  console.log(`Evaluating condition: ${field} ${operator} ${value}`);
  console.log(`Field value: ${fieldValue}`);

  const result = operatorFunctions[operator](fieldValue, value);
  console.log(`Condition result: ${result}`);

  return result;
}
