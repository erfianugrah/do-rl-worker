const BODY_SIZE_LIMIT = 524288; // 512 KB in bytes

function isIPInCIDR(ip, cidr) {
  const [range, bits = 32] = cidr.split("/");
  const mask = ~(2 ** (32 - bits) - 1);
  const ipInt =
    ip.split(".").reduce((int, oct) => (int << 8) + parseInt(oct, 10), 0) >>> 0;
  const rangeInt =
    range.split(".").reduce((int, oct) => (int << 8) + parseInt(oct, 10), 0) >>>
    0;
  return (ipInt & mask) === (rangeInt & mask);
}

function getNestedValue(obj, path) {
  return path.split(".").reduce(
    (current, part) => current && current[part],
    obj,
  );
}

const fieldFunctions = {
  clientIP: (request) =>
    request.headers.get("true-client-ip") ||
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    request.cf?.clientIp,
  method: (request) => request.method,
  url: (request) => request.url,
  body: async (request) => {
    try {
      const clonedRequest = request.clone();
      const reader = clonedRequest.body.getReader();
      let body = "";
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
            `Request body exceeded ${BODY_SIZE_LIMIT} bytes. Truncating.`,
          );
          break;
        }
      }

      return body;
    } catch (error) {
      console.error("Error reading request body:", error);
      return "";
    }
  },
  headers: (request, headerName) => request.headers.get(headerName),
  cf: (request, cfProperty) => getNestedValue(request.cf, cfProperty),
};

const operatorFunctions = {
  eq: (a, b, field) => {
    if (field === "clientIP") {
      return b.includes("/") ? isIPInCIDR(a, b) : a === b;
    }
    return a === b;
  },
  ne: (a, b) => a !== b,
  gt: (a, b) => parseFloat(a) > parseFloat(b),
  ge: (a, b) => parseFloat(a) >= parseFloat(b),
  lt: (a, b) => parseFloat(a) < parseFloat(b),
  le: (a, b) => parseFloat(a) <= parseFloat(b),
  contains: (a, b) => String(a).includes(b),
  not_contains: (a, b) => !String(a).includes(b),
  starts_with: (a, b) => String(a).startsWith(b),
  ends_with: (a, b) => String(a).endsWith(b),
  matches: (a, b) => {
    try {
      return new RegExp(b).test(String(a));
    } catch (error) {
      console.error("Invalid regex:", b, error);
      return false;
    }
  },
};

// condition-evaluator.js

export async function evaluateConditions(request, conditions, logic = "and") {
  console.log(`Evaluating conditions with logic: ${logic}`);
  console.log(`Conditions:`, JSON.stringify(conditions, null, 2));

  if (!Array.isArray(conditions)) {
    console.warn("Invalid conditions structure");
    return false;
  }

  let result = logic === "and";
  for (let i = 0; i < conditions.length; i++) {
    const condition = conditions[i];
    if (condition.type === "operator") {
      console.log(`Switching logic to: ${condition.logic}`);
      logic = condition.logic;
      continue;
    }

    let conditionResult;
    if ("conditions" in condition) {
      console.log("Evaluating nested condition group:");
      conditionResult = await evaluateConditions(
        request,
        condition.conditions,
        "and",
      );
    } else {
      conditionResult = await evaluateCondition(request, condition);
    }

    if (logic === "and") {
      result = result && conditionResult;
      console.log(`AND result so far: ${result}`);
      if (!result) break; // Short-circuit for AND
    } else {
      result = result || conditionResult;
      console.log(`OR result so far: ${result}`);
      if (result) break; // Short-circuit for OR
    }
  }

  console.log(`Final result for this condition group: ${result}`);
  return result;
}

async function evaluateCondition(request, condition) {
  const { field, operator, value } = condition;
  let fieldValue;

  console.log(`Evaluating condition: ${field} ${operator} ${value}`);

  if (field.startsWith("url.")) {
    const url = new URL(request.url);
    fieldValue = getNestedValue(url, field.slice(4));
  } else if (field.startsWith("headers.")) {
    fieldValue = request.headers.get(field.slice(8));
  } else if (field.startsWith("cf.")) {
    fieldValue = getNestedValue(request.cf, field.slice(3));
  } else if (field.startsWith("body.")) {
    const bodyContent = await fieldFunctions.body(request);
    fieldValue = getNestedValue(JSON.parse(bodyContent), field.slice(5));
  } else if (fieldFunctions[field]) {
    fieldValue = await fieldFunctions[field](request);
  } else {
    console.warn(`Invalid field: ${field}`);
    return false;
  }

  if (!operatorFunctions[operator]) {
    console.warn(`Invalid operator: ${operator}`);
    return false;
  }

  console.log(`Field value: ${fieldValue}`);

  const result = operatorFunctions[operator](fieldValue, value, field);
  console.log(`Condition result: ${result}`);

  return result;
}
