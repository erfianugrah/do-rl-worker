// staticpages.js
export function serveRateLimitPage(cooldownEndTime, headers) {
  const rateLimitPageContent = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Rate Limit Exceeded</title>
        <style>
            :root {
                color-scheme: light dark;
            }
            body {
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                display: flex;
                justify-content: center;
                align-items: center;
                height: 100vh;
                margin: 0;
                background-color: #f0f2f5;
                color: #555;
                transition: background-color 0.3s, color 0.3s;
            }
            @media (prefers-color-scheme: dark) {
                body {
                    background-color: #333;
                    color: #f0f2f5;
                }
            }
            .rate-limit-container {
                text-align: center;
                padding: 50px;
                border-radius: 10px;
                box-shadow: 0 5px 15px rgba(0, 0, 0, 0.1);
                max-width: 400px;
                width: 100%;
                background-color: #e0e0e0;
                transition: background-color 0.3s;
            }
            @media (prefers-color-scheme: dark) {
                .rate-limit-container {
                    background-color: #3c3c3c;
                }
            }
            h1 {
                margin-bottom: 30px;
                font-size: 24px;
            }
            #cooldownTimer {
                font-size: 20px;
                font-weight: bold;
                margin-bottom: 20px;
            }
            #retryButton {
                font-size: 16px;
                padding: 10px 20px;
                color: #fff;
                background-color: #007bff;
                border: none;
                border-radius: 5px;
                cursor: pointer;
                transition: background-color 0.2s;
            }
            #retryButton:hover {
                background-color: #0056b3;
            }
        </style>
    </head>
    <body>
        <div class="rate-limit-container">
            <h1 id="rateLimitTitle">Rate Limit Exceeded</h1>
            <p id="cooldownMessage">You have exceeded the rate limit for requests. Please wait until the cooldown period has passed before making another request.</p>
            <p>Cooldown ends in <span id="cooldownTimer"></span></p>
            <button id="retryButton" style="display:none;">Retry Now</button>
        </div>
        <script>
            const cooldownEndTime = new Date("${cooldownEndTime.toISOString()}").getTime();
            const timerElement = document.getElementById('cooldownTimer');
            const retryButton = document.getElementById('retryButton');
            const cooldownMessage = document.getElementById('cooldownMessage');
            const rateLimitTitle = document.getElementById('rateLimitTitle');
            let redirectTimeout;

            function updateTimer() {
                const now = new Date().getTime();
                const distance = cooldownEndTime - now;

                if (distance < 0) {
                    clearInterval(interval);
                    rateLimitTitle.textContent = "You can now retry your request";
                    cooldownMessage.style.display = 'none';
                    timerElement.parentElement.style.display = 'none';
                    retryButton.style.display = 'inline-block';
                    redirectTimeout = setTimeout(function() {
                        window.location.reload();
                    }, 5000);
                    return;
                }

                const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
                const seconds = Math.floor((distance % (1000 * 60)) / 1000);

                timerElement.innerHTML = minutes + "m " + seconds + "s ";
            }

            retryButton.addEventListener('click', function() {
                clearTimeout(redirectTimeout);
                window.location.reload();
            });

            const interval = setInterval(updateTimer, 1000);
            updateTimer();
        </script>
    </body>
    </html>
  `;

  return new Response(rateLimitPageContent, {
    status: 429,
    headers: {
      ...headers,
      'Content-Type': 'text/html',
    },
  });
}
