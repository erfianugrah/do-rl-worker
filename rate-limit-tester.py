#!/usr/bin/env python3

import argparse
import requests
import time
import json
import statistics
from datetime import datetime
from colorama import Fore, Style, init
import concurrent.futures
import threading
import sys

# Initialize colorama
init(autoreset=True)

# Global variables for storing results
results = []
result_lock = threading.Lock()

def parse_arguments():
    parser = argparse.ArgumentParser(description="Test rate limiting on a URL")
    parser.add_argument("-u", "--url", required=True, help="URL to test")
    parser.add_argument("-n", "--requests", type=int, default=20, help="Number of requests to send")
    parser.add_argument("-d", "--delay", type=float, default=0, help="Delay between requests in seconds")
    parser.add_argument("-f", "--format", choices=["table", "json", "csv"], default="table", help="Output format")
    parser.add_argument("-v", "--verbose", action="store_true", help="Verbose mode")
    parser.add_argument("-H", "--headers", action="append", help="Custom headers")
    parser.add_argument("-t", "--timeout", type=float, default=30, help="Request timeout in seconds")
    parser.add_argument("-L", "--follow-redirects", action="store_true", help="Follow redirects")
    parser.add_argument("-c", "--concurrency", type=int, default=10, help="Number of concurrent requests")
    parser.add_argument("--help-tags", action="store_true", help="Display help for output tags")
    return parser.parse_args()

def display_tag_help():
    print(f"{Fore.YELLOW}Output Tag Help:{Style.RESET_ALL}")
    print("| Tag      | Description                                      |")
    print("|----------|--------------------------------------------------|")
    print("| Request  | Request number                                   |")
    print("| Status   | HTTP status code of the response                 |")
    print("| Limit    | Rate limit (requests allowed in the time period) |")
    print("| Remain   | Remaining requests allowed                       |")
    print("| Reset    | Time when the rate limit resets                  |")
    print("| Period   | Time period for the rate limit (in seconds)      |")
    print("| Retry    | Time to wait before retrying (if rate limited)   |")
    print("| Response | Response time in milliseconds                    |")

def parse_headers(headers):
    limit = headers.get("X-Rate-Limit-Limit")
    remaining = headers.get("X-Rate-Limit-Remaining")
    reset = headers.get("X-Rate-Limit-Reset")
    period = headers.get("X-Rate-Limit-Period")
    retry_after = headers.get("Retry-After")
    return limit, remaining, reset, period, retry_after

def format_date(timestamp):
    if timestamp and timestamp != "null":
        try:
            return datetime.fromtimestamp(float(timestamp)).strftime("%Y-%m-%d %H:%M:%S")
        except ValueError:
            return "Invalid date"
    return "N/A"

def display_table(request_num, status_code, limit, remaining, reset, period, retry_after, response_time):
    color = Fore.RED if status_code == 429 else Fore.GREEN
    print(color + f"| {request_num:<7} | {status_code:<6} | {limit or 'N/A':<5} | {remaining or 'N/A':<6} | {format_date(reset):<19} | {period or 'N/A':<6} | {retry_after or 'N/A':<5} | {response_time:.0f}ms |")

def display_json(request_num, status_code, limit, remaining, reset, period, retry_after, response_time):
    return {
        "request_num": request_num,
        "status_code": status_code,
        "limit": limit or "N/A",
        "remaining": remaining or "N/A",
        "reset": format_date(reset),
        "period": period or "N/A",
        "retry_after": retry_after or "N/A",
        "response_time": f"{response_time:.0f}ms"
    }

def display_csv(request_num, status_code, limit, remaining, reset, period, retry_after, response_time):
    return f"{request_num},{status_code},{limit or 'N/A'},{remaining or 'N/A'},{format_date(reset)},{period or 'N/A'},{retry_after or 'N/A'},{response_time:.0f}"

def calculate_statistics(times, codes):
    success_count = sum(1 for code in codes if 200 <= code < 300)
    success_rate = (success_count / len(codes)) * 100

    mean_time = statistics.mean(times)
    median_time = statistics.median(times)
    std_dev = statistics.stdev(times) if len(times) > 1 else 0
    p95 = statistics.quantiles(times, n=20)[-1] if len(times) >= 20 else max(times)  # 95th percentile

    print(f"\n{Fore.BLUE}Statistical Analysis:{Style.RESET_ALL}")
    print(f"  Mean Response Time: {mean_time:.2f}ms")
    print(f"  Median Response Time: {median_time:.2f}ms")
    print(f"  Standard Deviation: {std_dev:.2f}ms")
    print(f"  95th Percentile: {p95:.2f}ms")
    print(f"  Success Rate: {success_rate:.2f}%")

def generate_chart(times, codes):
    max_height = 20
    width = len(times)
    max_time = max(times)

    chart = []
    for i in range(max_height):
        row = []
        for j in range(width):
            if codes[j] == 200:
                if (max_height - i) <= (times[j] * max_height / max_time):
                    row.append("█")
                else:
                    row.append(" ")
            else:
                if (max_height - i) <= 1:
                    row.append("▄")
                else:
                    row.append(" ")
        chart.append("".join(row))

    print(f"\n{Fore.BLUE}Request Visualization:{Style.RESET_ALL}")
    for row in chart:
        print(row)
    print("-" * width)
    print("Success (█) vs Rate Limited (▄)")

def make_request(args, headers, request_num):
    start_time = time.time()
    try:
        response = requests.get(args.url, headers=headers, timeout=args.timeout, allow_redirects=args.follow_redirects)
    except requests.RequestException as e:
        print(f"Request {request_num} failed: {e}")
        return None

    end_time = time.time()
    response_time = (end_time - start_time) * 1000  # Convert to milliseconds

    status_code = response.status_code
    limit, remaining, reset, period, retry_after = parse_headers(response.headers)

    result = {
        "request_num": request_num,
        "status_code": status_code,
        "limit": limit,
        "remaining": remaining,
        "reset": reset,
        "period": period,
        "retry_after": retry_after,
        "response_time": response_time,
        "response": response
    }

    with result_lock:
        results.append(result)

    if args.format == "table":
        display_table(request_num, status_code, limit, remaining, reset, period, retry_after, response_time)
    elif args.format == "csv":
        print(display_csv(request_num, status_code, limit, remaining, reset, period, retry_after, response_time))

    if args.verbose:
        print(f"\n{Fore.BLUE}Request {request_num} Details:{Style.RESET_ALL}")
        print(f"{Fore.YELLOW}All Headers:{Style.RESET_ALL}")
        for header, value in response.headers.items():
            print(f"{header}: {value}")
        print(f"{Fore.YELLOW}Response Body:{Style.RESET_ALL}")
        print(json.dumps(response.json(), indent=2) if response.headers.get('Content-Type') == 'application/json' else response.text)
        print(f"{Fore.BLUE}------------------------{Style.RESET_ALL}")

    return result

def main():
    args = parse_arguments()

    if args.help_tags:
        display_tag_help()
        sys.exit(0)

    headers = {"Accept": "application/json"}
    if args.headers:
        for header in args.headers:
            key, value = header.split(":", 1)
            headers[key.strip()] = value.strip()

    print(f"{Fore.YELLOW}Rate Limiter Test Results for {args.url}")
    print(f"Requests: {args.requests}, Delay: {args.delay} seconds, Concurrency: {args.concurrency}{Style.RESET_ALL}")

    if args.format == "table":
        print("| Request | Status | Limit | Remain | Reset Time           | Period | Retry | Response |")
        print("|---------|--------|-------|--------|---------------------|--------|-------|----------|")

    with concurrent.futures.ThreadPoolExecutor(max_workers=args.concurrency) as executor:
        futures = []
        for i in range(1, args.requests + 1):
            futures.append(executor.submit(make_request, args, headers, i))
            if args.delay > 0:
                time.sleep(args.delay)

        concurrent.futures.wait(futures)

    results.sort(key=lambda x: x["request_num"])

    if args.format == "json":
        json_output = [display_json(**r) for r in results]
        print(json.dumps(json_output, indent=2))

    response_times = [r["response_time"] for r in results]
    status_codes = [r["status_code"] for r in results]

    calculate_statistics(response_times, status_codes)
    generate_chart(response_times, status_codes)

    print(f"\n{Fore.GREEN}Test completed.{Style.RESET_ALL}")

if __name__ == "__main__":
    main()
