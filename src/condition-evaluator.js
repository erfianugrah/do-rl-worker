export async function evaluateCondition(request, condition) {
  const { field, operator, value } = condition;

  let fieldValue = await getFieldValue(request, field);

  switch (operator) {
    case 'eq':
      return fieldValue === value;
    case 'ne':
      return fieldValue !== value;
    case 'gt':
      return fieldValue > value;
    case 'ge':
      return fieldValue >= value;
    case 'lt':
      return fieldValue < value;
    case 'le':
      return fieldValue <= value;
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
      throw new Error(`Unknown operator: ${operator}`);
  }
}

async function getFieldValue(request, field) {
  const url = new URL(request.url);

  switch (field) {
    case 'http.host':
      return url.hostname;
    case 'http.method':
      return request.method;
    case 'http.path':
      return url.pathname;
    case 'http.url':
      return request.url;
    case 'http.user_agent':
      return request.headers.get('User-Agent');
    case 'ip.src':
      return request.headers.get('CF-Connecting-IP');
    case 'ssl':
      return url.protocol === 'https:';
    case 'http.referer':
      return request.headers.get('Referer');
    case 'http.x_forwarded_for':
      return request.headers.get('X-Forwarded-For');
    case 'http.cookie':
      return request.headers.get('Cookie');
    case 'http.origin':
      return request.headers.get('Origin');
    default:
      if (field.startsWith('http.header.')) {
        const headerName = field.substring('http.header.'.length);
        return request.headers.get(headerName);
      }
      throw new Error(`Unknown field: ${field}`);
  }
}
