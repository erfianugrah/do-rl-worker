export async function evaluateCondition(request, condition) {
  const { field, operator, value } = condition;

  console.log(`Evaluating condition: ${field} ${operator} ${value}`);

  let fieldValue = await getFieldValue(request, field);
  console.log(`Field value: ${fieldValue}`);

  // Convert to number for numeric fields
  const numericFields = [
    'http.content_length',
    'cf.asn',
    'cf.bot_management.score',
    'cf.client_tcp_rtt',
    'cf.threat_score',
  ];
  if (numericFields.includes(field)) {
    fieldValue = parseFloat(fieldValue);
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

  // String comparisons
  console.log(`String comparison: "${fieldValue}" ${operator} "${value}"`);
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
      console.warn(`Unknown operator: ${operator}`);
      return false;
  }
}

async function getFieldValue(request, field) {
  const url = new URL(request.url);
  const cf = request.cf || {};

  console.log(`Getting field value for: ${field}`);

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
      return request.headers.get('User-Agent') || '';
    case 'ip.src':
      return request.headers.get('CF-Connecting-IP') || '';
    case 'ssl':
      return url.protocol === 'https:';
    case 'http.referer':
      return request.headers.get('Referer') || '';
    case 'http.x_forwarded_for':
      return request.headers.get('X-Forwarded-For') || '';
    case 'http.cookie':
      return request.headers.get('Cookie') || '';
    case 'http.origin':
      return request.headers.get('Origin') || '';
    case 'http.content_type':
      return request.headers.get('Content-Type') || '';
    case 'http.content_length':
      return request.headers.get('Content-Length') || '';
    case 'http.accept':
      return request.headers.get('Accept') || '';
    case 'http.accept_encoding':
      return request.headers.get('Accept-Encoding') || '';
    case 'http.accept_language':
      return request.headers.get('Accept-Language') || '';
    case 'http.authorization':
      return request.headers.get('Authorization') || '';
    case 'http.cache_control':
      return request.headers.get('Cache-Control') || '';
    case 'http.if_modified_since':
      return request.headers.get('If-Modified-Since') || '';
    case 'http.if_none_match':
      return request.headers.get('If-None-Match') || '';
    case 'http.pragma':
      return request.headers.get('Pragma') || '';
    case 'http.query':
      return url.search.slice(1); // Remove the leading '?'
    case 'http.body':
      try {
        const clone = request.clone();
        const body = await clone.text();
        return body;
      } catch (error) {
        console.error('Error reading request body:', error);
        return '';
      }
    case 'cf.asn':
      return cf.asn?.toString() || '';
    case 'cf.country':
      return cf.country || '';
    case 'cf.colo':
      return cf.colo || '';
    case 'cf.bot_management.score':
      return cf.botManagement?.score?.toString() || '';
    case 'cf.client_tcp_rtt':
      return cf.clientTcpRtt?.toString() || '';
    case 'cf.threat_score':
      return cf.threatScore?.toString() || '';
    default:
      if (field.startsWith('http.header.')) {
        const headerName = field.substring('http.header.'.length);
        return request.headers.get(headerName) || '';
      }
      console.warn(`Unknown field: ${field}`);
      return '';
  }
}
