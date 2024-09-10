export function serveRateLimitPage(env, request, rateLimitInfo) {
  const acceptHeader = request.headers.get('Accept');
  const statusCode = 429; // Too Many Requests

  // Check if the request prefers HTML
  if (!acceptHeader || !acceptHeader.includes('text/html')) {
    // Respond with JSON for non-browser clients
    return new Response(
      JSON.stringify({
        status: statusCode,
        message: 'Rate limit exceeded',
        retryAfter: rateLimitInfo.retryAfter,
        limit: rateLimitInfo.limit,
        period: rateLimitInfo.period,
        reset: rateLimitInfo.reset,
      }),
      {
        status: statusCode,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store, max-age=0',
          'Retry-After': rateLimitInfo.retryAfter,
        },
      }
    );
  }

  const rateLimitPageContent = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Rate Limit Exceeded</title>
        <style>
            body {
                font-family: Arial, sans-serif;
                display: flex;
                justify-content: center;
                align-items: center;
                height: 100vh;
                margin: 0;
                background-color: #f0f2f5;
            }
            .rate-limit-container {
                text-align: center;
                padding: 50px;
                border-radius: 10px;
                box-shadow: 0 5px 15px rgba(0, 0, 0, 0.1);
                background-color: #ffffff;
                max-width: 600px;
                width: 90%;
            }
            h1 { color: #e74c3c; }
            #countdown { font-weight: bold; color: #e74c3c; }
            .status-code { color: #7f8c8d; margin-top: 20px; }
            .info-item { margin: 10px 0; }
            .reset-time { font-weight: bold; color: #3498db; }
        </style>
    </head>
    <body>
        <div class="rate-limit-container">
            <h1>Rate Limit Exceeded</h1>
            <p>You have exceeded the rate limit of ${rateLimitInfo.limit} requests per ${rateLimitInfo.period} seconds.</p>
            <p>Please try again in <span id="countdown">${rateLimitInfo.retryAfter}</span> seconds.</p>
            <div class="info-item">Limit: ${rateLimitInfo.limit} requests</div>
            <div class="info-item">Period: ${rateLimitInfo.period} seconds</div>
            <div class="info-item">Reset time: <span class="reset-time">${new Date(rateLimitInfo.reset * 1000).toLocaleString()}</span></div>
            <p class="status-code">Status Code: ${statusCode}</p>
        </div>
        <script>
            let timeLeft = ${rateLimitInfo.retryAfter};
            const countdownElement = document.getElementById('countdown');
            const countdownTimer = setInterval(() => {
                if(timeLeft <= 0) {
                    clearInterval(countdownTimer);
                    countdownElement.textContent = "0";
                    location.reload();
                } else {
                    countdownElement.textContent = timeLeft;
                }
                timeLeft -= 1;
            }, 1000);
        </script>
    </body>
    </html>
  `;

  return new Response(rateLimitPageContent, {
    status: statusCode,
    headers: {
      'Content-Type': 'text/html',
      'Cache-Control': 'no-store, max-age=0',
      'Retry-After': rateLimitInfo.retryAfter,
    },
  });
}

export function serveRateLimitInfoPage(env, request, rateLimitInfo) {
  const acceptHeader = request.headers.get('Accept');
  const statusCode = 200; // OK

  // Check if the request prefers HTML
  if (!acceptHeader || !acceptHeader.includes('text/html')) {
    // Respond with JSON for non-browser clients
    return new Response(
      JSON.stringify({
        status: statusCode,
        limit: rateLimitInfo.limit,
        period: rateLimitInfo.period,
        remaining: rateLimitInfo.remaining,
        reset: rateLimitInfo.reset,
      }),
      {
        status: statusCode,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store, max-age=0',
        },
      }
    );
  }

  const rateLimitInfoPageContent = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Rate Limit Information</title>
        <style>
            body {
                font-family: Arial, sans-serif;
                display: flex;
                justify-content: center;
                align-items: center;
                height: 100vh;
                margin: 0;
                background-color: #f0f2f5;
            }
            .info-container {
                text-align: center;
                padding: 50px;
                border-radius: 10px;
                box-shadow: 0 5px 15px rgba(0, 0, 0, 0.1);
                background-color: #ffffff;
            }
            h1 { color: #3498db; }
            .info-item { margin: 10px 0; }
            .status-code { color: #7f8c8d; margin-top: 20px; }
        </style>
    </head>
    <body>
        <div class="info-container">
            <h1>Rate Limit Information</h1>
            <div class="info-item">Limit: ${rateLimitInfo.limit} requests</div>
            <div class="info-item">Period: ${rateLimitInfo.period} seconds</div>
            <div class="info-item">Remaining: ${rateLimitInfo.remaining}</div>
            <div class="info-item">Reset: ${new Date(rateLimitInfo.reset * 1000).toLocaleString()}</div>
            <p class="status-code">Status Code: ${statusCode}</p>
        </div>
    </body>
    </html>
  `;

  return new Response(rateLimitInfoPageContent, {
    status: statusCode,
    headers: {
      'Content-Type': 'text/html',
      'Cache-Control': 'no-store, max-age=0',
    },
  });
}
