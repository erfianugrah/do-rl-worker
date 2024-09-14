const BODY_SIZE_LIMIT = 524288; // 512 KB in bytes

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
};

export async function evaluateConditions(request, conditions, logic = 'and') {
  console.log(`Evaluating conditions with logic: ${logic}`);
  console.log(`Conditions:`, JSON.stringify(conditions, null, 2));

  if (!Array.isArray(conditions)) {
    console.warn('Invalid conditions structure');
    return false;
  }

  for (const condition of conditions) {
    let result;
    if (condition.type === 'group') {
      result = await evaluateConditions(request, condition.conditions, condition.logic);
    } else {
      result = await evaluateCondition(request, condition);
    }

    if (logic === 'or' && result) {
      return true;
    }
    if (logic === 'and' && !result) {
      return false;
    }
  }

  return logic === 'and';
}

async function evaluateCondition(request, condition) {
  const { field, operator, value, headerName, headerValue } = condition;

  console.log(`Evaluating condition: ${field} ${operator} ${value}`);

  let fieldValue;
  if (field === 'headers') {
    fieldValue = request.headers.get(headerName) || '';
  } else if (field === 'headers.name') {
    fieldValue = request.headers.has(headerName) ? headerName : '';
  } else if (field === 'headers.nameValue') {
    fieldValue =
      request.headers.get(headerName) === headerValue ? `${headerName}: ${headerValue}` : '';
  } else {
    fieldValue = await getFieldValue(request, field);
  }

  console.log(`Field value: ${fieldValue}`);

  // Convert to number for numeric fields
  const numericFields = [
    'cf.asn',
    'cf.botManagement.score',
    'cf.clientTrustScore',
    'cf.latitude',
    'cf.longitude',
    'cf.tlsClientHelloLength',
  ];
  if (numericFields.includes(field)) {
    fieldValue = parseFloat(fieldValue);
    return evaluateNumericCondition(fieldValue, operator, value);
  }

  // String comparisons
  console.log(`String comparison: "${fieldValue}" ${operator} "${value}"`);
  return evaluateStringCondition(fieldValue, operator, value);
}

function evaluateNumericCondition(fieldValue, operator, value) {
  const numericValue = parseFloat(value);
  console.log(`Numeric comparison: ${fieldValue} ${operator} ${numericValue}`);

  switch (operator) {
    case 'eq':
      return fieldValue === numericValue;
    case 'ne':
      return fieldValue !== numericValue;
    case 'gt':
      return fieldValue > numericValue;
    case 'ge':
      return fieldValue >= numericValue;
    case 'lt':
      return fieldValue < numericValue;
    case 'le':
      return fieldValue <= numericValue;
    default:
      console.warn(`Numeric operator not applicable: ${operator}`);
      return false;
  }
}

function evaluateStringCondition(fieldValue, operator, value) {
  switch (operator) {
    case 'eq':
      return fieldValue === value;
    case 'ne':
      return fieldValue !== value;
    case 'contains':
      return fieldValue.includes(value);
    case 'not_contains':
      return !fieldValue.includes(value);
    case 'starts_with':
      return fieldValue.startsWith(value);
    case 'ends_with':
      return fieldValue.endsWith(value);
    case 'matches':
      return new RegExp(value).test(fieldValue);
    default:
      console.warn(`Unknown operator: ${operator}`);
      return false;
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

async function getFieldValue(request, field) {
  const url = new URL(request.url);
  const cf = request.cf || {};

  console.log(`Getting field value for: ${field}`);

  if (field.startsWith('headers.')) {
    const headerName = field.substring('headers.'.length);
    return request.headers.get(headerName) || '';
  }

  if (field.startsWith('url.')) {
    return getNestedValue(url, field.substring('url.'.length)) || '';
  }

  if (field.startsWith('cf.')) {
    return getNestedValue(cf, field.substring('cf.'.length)) || '';
  }

  if (field in fieldFunctions) {
    return await fieldFunctions[field](request);
  }

  console.warn(`Unknown field: ${field}`);
  return '';
}

// function getCfValue(cf, path) {
//   return path.split('.').reduce((obj, key) => {
//     if (obj && typeof obj === 'object' && key in obj) {
//       return obj[key];
//     }
//     return undefined;
//   }, cf);
// }
