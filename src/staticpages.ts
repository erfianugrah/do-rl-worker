interface RateLimitInfo {
  limit: number;
  period: number;
  remaining?: number;
  reset: number;
  retryAfter?: number;
  resetFormatted?: string;
}

const commonStyles = `
  body {
    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    display: flex;
    justify-content: center;
    align-items: center;
    min-height: 100vh;
    margin: 0;
    transition: background-color 0.3s, color 0.3s;
  }
  body.light {
    background-color: #f0f4f8;
    color: #333;
  }
  body.dark {
    background-color: #1a202c;
    color: #e2e8f0;
  }
  .container {
    text-align: center;
    padding: 2rem;
    border-radius: 12px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.1);
    max-width: 600px;
    width: 90%;
  }
  .light .container {
    background-color: #ffffff;
  }
  .dark .container {
    background-color: #2d3748;
  }
  h1 {
    margin-bottom: 1.5rem;
  }
  .light h1 {
    color: #2c3e50;
  }
  .dark h1 {
    color: #e2e8f0;
  }
  .info-item {
    margin: 0.75rem 0;
    font-size: 1.1rem;
  }
  .status-code {
    margin-top: 1.5rem;
    font-size: 0.9rem;
  }
  .light .status-code {
    color: #7f8c8d;
  }
  .dark .status-code {
    color: #a0aec0;
  }
  #countdown, .reset-time {
    font-weight: bold;
  }
  .light #countdown, .light .reset-time {
    color: #e74c3c;
  }
  .dark #countdown, .dark .reset-time {
    color: #fc8181;
  }
  .theme-toggle {
    position: absolute;
    top: 1rem;
    right: 1rem;
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
  }
  .theme-toggle svg {
    width: 24px;
    height: 24px;
    fill: currentColor;
  }
  .quote {
    font-style: italic;
    margin-top: 2rem;
    padding: 1rem;
    border-radius: 8px;
    background-color: rgba(0, 0, 0, 0.05);
  }
  .dark .quote {
    background-color: rgba(255, 255, 255, 0.05);
  }
`;

const ronBurgundyQuotes = [
  "I'm kind of a big deal.",
  "Stay classy, San Diego!",
  "I'm in a glass case of emotion!",
  "Milk was a bad choice.",
  "I love lamp.",
  "60% of the time, it works every time.",
  "I don't know how to put this, but I'm kind of a big deal.",
  "You stay classy, San Diego.",
];

function getRandomQuote(): string {
  return ronBurgundyQuotes[
    Math.floor(Math.random() * ronBurgundyQuotes.length)
  ];
}

function generateHTMLContent(
  pageType: "rateLimit" | "rateLimitInfo",
  rateLimitInfo: RateLimitInfo,
): string {
  const rateLimitContent = `
    <h1>Rate Limit Exceeded</h1>
    <p>You have exceeded the rate limit of ${rateLimitInfo.limit} requests per ${rateLimitInfo.period} seconds.</p>
    <p>Please try again in <span id="countdown">${rateLimitInfo.retryAfter}</span> seconds.</p>
    <div class="info-item">Limit: ${rateLimitInfo.limit} requests</div>
    <div class="info-item">Period: ${rateLimitInfo.period} seconds</div>
    <div class="info-item">Reset time: <span class="reset-time">${rateLimitInfo.resetFormatted}</span></div>
    <p class="status-code">Status Code: 429</p>
  `;

  const rateLimitInfoContent = `
    <h1>Rate Limit Information</h1>
    <div class="info-item">Limit: ${rateLimitInfo.limit} requests</div>
    <div class="info-item">Period: ${rateLimitInfo.period} seconds</div>
    <div class="info-item">Remaining: ${rateLimitInfo.remaining}</div>
    <div class="info-item">Reset: ${
    new Date(rateLimitInfo.reset * 1000).toLocaleString()
  }</div>
    <p class="status-code">Status Code: 200</p>
  `;

  const content = pageType === "rateLimit"
    ? rateLimitContent
    : rateLimitInfoContent;
  const quote = getRandomQuote();

  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${
    pageType === "rateLimit" ? "Rate Limit Exceeded" : "Rate Limit Information"
  }</title>
        <style>${commonStyles}</style>
    </head>
    <body>
        <div class="container">
            <button onclick="toggleTheme()" class="theme-toggle" aria-label="Toggle dark mode">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-moon">
                    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
                </svg>
            </button>
            ${content}
            <div class="quote">"${quote}" - Ron Burgundy</div>
        </div>
        <script>
            function setTheme(theme) {
                document.body.className = theme;
                const themeToggle = document.querySelector('.theme-toggle svg');
                if (theme === 'dark') {
                    themeToggle.innerHTML = '<path d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"></path>';
                } else {
                    themeToggle.innerHTML = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>';
                }
                localStorage.setItem('theme', theme);
            }

            function toggleTheme() {
                const currentTheme = document.body.className;
                setTheme(currentTheme === 'light' ? 'dark' : 'light');
            }

            // Check for saved theme preference or use system preference
            const savedTheme = localStorage.getItem('theme');
            if (savedTheme) {
                setTheme(savedTheme);
            } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
                setTheme('dark');
            } else {
                setTheme('light');
            }

            // Listen for changes in system color scheme
            window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
                if (!localStorage.getItem('theme')) {
                    setTheme(e.matches ? 'dark' : 'light');
                }
            });

            ${
    pageType === "rateLimit"
      ? `
            let timeLeft = ${rateLimitInfo.retryAfter};
            const countdownElement = document.getElementById('countdown');
            const countdownTimer = setInterval(() => {
                if(timeLeft <= 0) {
                    clearInterval(countdownTimer);
                    countdownElement.textContent = "0";
                    location.reload();
                } else {
                    countdownElement.textContent = timeLeft.toFixed(1);
                }
                timeLeft -= 0.1;
            }, 100);
            `
      : ""
  }
        </script>
    </body>
    </html>
  `;
}

export function serveRateLimitPage(
  env: any,
  request: Request,
  rateLimitInfo: RateLimitInfo,
): Response {
  const acceptHeader = request.headers.get("Accept");
  const statusCode = 429; // Too Many Requests

  if (!acceptHeader || !acceptHeader.includes("text/html")) {
    return new Response(
      JSON.stringify({
        status: statusCode,
        message: "Rate limit exceeded",
        ...rateLimitInfo,
      }),
      {
        status: statusCode,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store, max-age=0",
          "Retry-After": rateLimitInfo.retryAfter?.toString() || "",
        },
      },
    );
  }

  const htmlContent = generateHTMLContent("rateLimit", rateLimitInfo);

  return new Response(htmlContent, {
    status: statusCode,
    headers: {
      "Content-Type": "text/html",
      "Cache-Control": "no-store, max-age=0",
      "Retry-After": rateLimitInfo.retryAfter?.toString() || "",
    },
  });
}

export function serveRateLimitInfoPage(
  env: any,
  request: Request,
  rateLimitInfo: RateLimitInfo,
): Response {
  const acceptHeader = request.headers.get("Accept");
  const statusCode = 200; // OK

  if (!acceptHeader || !acceptHeader.includes("text/html")) {
    return new Response(
      JSON.stringify({
        status: statusCode,
        ...rateLimitInfo,
      }),
      {
        status: statusCode,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store, max-age=0",
        },
      },
    );
  }

  const htmlContent = generateHTMLContent("rateLimitInfo", rateLimitInfo);

  return new Response(htmlContent, {
    status: statusCode,
    headers: {
      "Content-Type": "text/html",
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
