export async function handleRateLimit(request, env, matchingRule) {
  const startTime = Date.now();
  const rateLimiterId = env.RATE_LIMITER.idFromName("global");
  const rateLimiter = env.RATE_LIMITER.get(rateLimiterId);

  const headers = new Headers(request.headers);
  headers.set("X-Rate-Limit-Config", JSON.stringify(matchingRule));
  headers.set("Content-Type", "application/json");

  let payload;
  try {
    const clonedRequest = request.clone();
    payload = {
      cf: request.cf || {},
      body: await clonedRequest.text(),
    };
  } catch (error) {
    console.error("Error reading request body:", error);
    payload = { cf: request.cf || {}, body: "" };
  }

  const rateLimiterRequest = new Request(request.url, {
    method: "POST",
    headers: headers,
    body: JSON.stringify(payload),
  });

  const rateLimitResponse = await rateLimiter.fetch(rateLimiterRequest);
  const endTime = Date.now();
  console.log(`handleRateLimit took ${endTime - startTime}ms`);
  return { rateLimitInfo: await rateLimitResponse.json(), rateLimitResponse };
}

export function applyRateLimitHeaders(response, rateLimitResponse) {
  const startTime = Date.now();
  const newHeaders = new Headers(response.headers);
  [
    "X-Rate-Limit-Remaining",
    "X-Rate-Limit-Limit",
    "X-Rate-Limit-Period",
    "X-Rate-Limit-Reset",
  ].forEach((header) => {
    const value = rateLimitResponse.headers.get(header);
    if (value) {
      newHeaders.set(header, value);
      console.log("Set", header + ":", value);
    }
  });

  const endTime = Date.now();
  console.log(`applyRateLimitHeaders took ${endTime - startTime}ms`);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
}
