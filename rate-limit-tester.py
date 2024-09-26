import argparse
import requests
import time
import json
import csv
import statistics
from datetime import datetime
from colorama import Fore, Style, init
import concurrent.futures
import threading
import sys
import numpy as np
import matplotlib.pyplot as plt

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
    parser.add_argument("--json-output", help="Output results to a JSON file")
    parser.add_argument("--csv-output", help="Output results to a CSV file")
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

def display_csv(request_num, status_code, limit, remaining, reset, period, retry_after, response_time):
    return f"{request_num},{status_code},{limit or 'N/A'},{remaining or 'N/A'},{format_date(reset)},{period or 'N/A'},{retry_after or 'N/A'},{response_time:.0f}"

def calculate_statistics(times, codes):
    success_count = sum(1 for code in codes if 200 <= code < 300)
    success_rate = (success_count / len(codes)) * 100

    mean_time = statistics.mean(times)
    median_time = statistics.median(times)
    std_dev = statistics.stdev(times) if len(times) > 1 else 0
    percentiles = np.percentile(times, [50, 75, 90, 95, 99])

    print(f"\n{Fore.BLUE}Statistical Analysis:{Style.RESET_ALL}")
    print(f"  Mean Response Time: {mean_time:.2f}ms")
    print(f"  Median Response Time: {median_time:.2f}ms")
    print(f"  Standard Deviation: {std_dev:.2f}ms")
    print(f"  50th Percentile: {percentiles[0]:.2f}ms")
    print(f"  75th Percentile: {percentiles[1]:.2f}ms")
    print(f"  90th Percentile: {percentiles[2]:.2f}ms")
    print(f"  95th Percentile: {percentiles[3]:.2f}ms")
    print(f"  99th Percentile: {percentiles[4]:.2f}ms")
    print(f"  Success Rate: {success_rate:.2f}%")

    return percentiles

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

def generate_graph(times, codes, percentiles):
    plt.figure(figsize=(15, 10))

    # Response time distribution
    plt.subplot(2, 1, 1)
    plt.hist(times, bins=50, edgecolor='black', alpha=0.7)
    plt.title('Response Time Distribution', fontsize=16)
    plt.xlabel('Response Time (ms)', fontsize=12)
    plt.ylabel('Frequency', fontsize=12)

    # Add vertical lines for percentiles and max outlier
    colors = ['r', 'g', 'b', 'c', 'm', 'y']
    labels = ['50th', '75th', '90th', '95th', '99th', 'Max']
    all_percentiles = list(percentiles) + [max(times)]

    for i, percentile in enumerate(all_percentiles):
        plt.axvline(percentile, color=colors[i], linestyle='dashed', linewidth=2,
                    label=f'{labels[i]} Percentile: {percentile:.2f}ms')

    plt.legend(fontsize=10, loc='upper right')
    plt.grid(True, linestyle='--', alpha=0.7)

    # Adjust x-axis to show the full range including the max outlier
    plt.xlim(0, max(times) * 1.05)  # Add 5% padding to the right

    # Status code distribution
    plt.subplot(2, 1, 2)
    status_counts = {code: codes.count(code) for code in set(codes)}
    bars = plt.bar(status_counts.keys(), status_counts.values(), edgecolor='black')
    plt.title('Status Code Distribution', fontsize=16)
    plt.xlabel('Status Code', fontsize=12)
    plt.ylabel('Count', fontsize=12)

    # Add value labels on top of each bar
    for bar in bars:
        height = bar.get_height()
        plt.text(bar.get_x() + bar.get_width()/2., height,
                 f'{height}',
                 ha='center', va='bottom')

    plt.grid(True, linestyle='--', alpha=0.7, axis='y')

    # Adjust layout and save
    plt.tight_layout()
    plt.savefig('rate_limit_test_results.png', dpi=300)
    print(f"\n{Fore.BLUE}Graph saved as rate_limit_test_results.png{Style.RESET_ALL}")

    # Display additional statistics
    total_requests = len(codes)
    success_count = codes.count(200)
    success_rate = (success_count / total_requests) * 100
    rate_limited = codes.count(429)

    print(f"\n{Fore.BLUE}Additional Statistics:{Style.RESET_ALL}")
    print(f"  Total Requests: {total_requests}")
    print(f"  Successful Requests (200): {success_count} ({success_rate:.2f}%)")
    print(f"  Rate Limited Requests (429): {rate_limited} ({(rate_limited/total_requests)*100:.2f}%)")
    print(f"  Other Status Codes:")
    for code, count in status_counts.items():
        if code not in [200, 429]:
            print(f"    {code}: {count} ({(count/total_requests)*100:.2f}%)")

    # Calculate and display average response times
    success_times = [t for t, c in zip(times, codes) if c == 200]
    rate_limited_times = [t for t, c in zip(times, codes) if c == 429]

    print(f"\n{Fore.BLUE}Response Time Statistics:{Style.RESET_ALL}")
    print(f"  All Requests: Avg = {sum(times) / len(times):.2f}ms, Max = {max(times):.2f}ms")
    if success_times:
        print(f"  Successful Requests: Avg = {sum(success_times) / len(success_times):.2f}ms, Max = {max(success_times):.2f}ms")
    if rate_limited_times:
        print(f"  Rate Limited Requests: Avg = {sum(rate_limited_times) / len(rate_limited_times):.2f}ms, Max = {max(rate_limited_times):.2f}ms")

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
        "response_time": response_time
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

def write_json_file(data, filename):
    with open(filename, 'w') as f:
        json.dump(data, f, indent=2)
    print(f"\n{Fore.BLUE}Results saved to JSON file: {filename}{Style.RESET_ALL}")

def write_csv_file(data, filename):
    with open(filename, 'w', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=data[0].keys())
        writer.writeheader()
        writer.writerows(data)
    print(f"\n{Fore.BLUE}Results saved to CSV file: {filename}{Style.RESET_ALL}")

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

    json_output = results  # No need for conversion, as the results are already in the correct format

    if args.format == "json":
        print(json.dumps(json_output, indent=2))

    if args.json_output:
        write_json_file(json_output, args.json_output)

    if args.csv_output:
        write_csv_file(json_output, args.csv_output)

    response_times = [r["response_time"] for r in results]
    status_codes = [r["status_code"] for r in results]

    percentiles = calculate_statistics(response_times, status_codes)
    generate_chart(response_times, status_codes)
    generate_graph(response_times, status_codes, percentiles)

    print(f"\n{Fore.GREEN}Test completed.{Style.RESET_ALL}")

if __name__ == "__main__":
    main()
