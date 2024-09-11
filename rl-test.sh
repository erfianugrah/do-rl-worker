#!/bin/bash

# Default configuration
URL=""
REQUESTS=20
DELAY=0
OUTPUT_FORMAT="table"
VERBOSE=false
CUSTOM_HEADERS=()
TIMEOUT=30
FOLLOW_REDIRECTS=false

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to display help message
show_help() {
    echo "Usage: $0 -u <URL> [-n <requests>] [-d <delay>] [-f <format>] [-v] [-H <header>] [-t <timeout>] [-L]"
    echo
    echo "Options:"
    echo "  -u <URL>       URL of the worker to test (required)"
    echo "  -n <requests>  Number of requests to send (default: 20)"
    echo "  -d <delay>     Delay between requests in seconds (default: 0)"
    echo "  -f <format>    Output format: table, json, or csv (default: table)"
    echo "  -v             Verbose mode: display all headers and response body"
    echo "  -H <header>    Add custom header (can be used multiple times)"
    echo "  -t <timeout>   Set request timeout in seconds (default: 30)"
    echo "  -L             Follow redirects"
    echo "  -h             Show this help message"
    echo
    exit 1
}

# Parse command-line options
while getopts "u:n:d:f:vH:t:Lh" opt; do
    case $opt in
        u) URL=$OPTARG ;;
        n) REQUESTS=$OPTARG ;;
        d) DELAY=$OPTARG ;;
        f) OUTPUT_FORMAT=$OPTARG ;;
        v) VERBOSE=true ;;
        H) CUSTOM_HEADERS+=("$OPTARG") ;;
        t) TIMEOUT=$OPTARG ;;
        L) FOLLOW_REDIRECTS=true ;;
        h) show_help ;;
        \?) echo "Invalid option: -$OPTARG" >&2; show_help ;;
    esac
done

# Validate required arguments
if [ -z "$URL" ]; then
    echo "Error: URL is required"
    show_help
fi

# Validate URL
if [[ ! $URL =~ ^https?:// ]]; then
    echo "Error: Invalid URL. Please enter a valid HTTP or HTTPS URL."
    exit 1
fi

# Validate output format
if [[ ! "$OUTPUT_FORMAT" =~ ^(table|json|csv)$ ]]; then
    echo "Error: Invalid output format. Please use table, json, or csv."
    exit 1
fi

# Function to parse rate limit headers
parse_headers() {
    local headers="$1"
    local limit=$(echo "$headers" | grep -i "X-Rate-Limit-Limit:" | cut -d' ' -f2 | tr -d '\r')
    local remaining=$(echo "$headers" | grep -i "X-Rate-Limit-Remaining:" | cut -d' ' -f2 | tr -d '\r')
    local reset=$(echo "$headers" | grep -i "X-Rate-Limit-Reset:" | cut -d' ' -f2 | tr -d '\r')
    local period=$(echo "$headers" | grep -i "X-Rate-Limit-Period:" | cut -d' ' -f2 | tr -d '\r')
    local retry_after=$(echo "$headers" | grep -i "Retry-After:" | cut -d' ' -f2 | tr -d '\r')
    
    echo "$limit|$remaining|$reset|$period|$retry_after"
}

# Function to format date
format_date() {
    if [ -n "$1" ] && [ "$1" != "null" ]; then
        date -d "@$1" "+%Y-%m-%d %H:%M:%S" 2>/dev/null || echo "Invalid date"
    else
        echo "N/A"
    fi
}

# Function to display results in table format
display_table() {
    local request_num="$1"
    local status_code="$2"
    local limit="$3"
    local remaining="$4"
    local reset="$5"
    local period="$6"
    local retry_after="$7"
    local response_time="$8"
    
    printf "| %-8s | %-11s | %-5s | %-9s | %-19s | %-6s | %-10s | %-8s |\n" \
           "$request_num" "$status_code" "${limit:-N/A}" "${remaining:-N/A}" "$(format_date "$reset")" "${period:-N/A}" "${retry_after:-N/A}" "${response_time}ms"
}

# Function to display results in JSON format
display_json() {
    local request_num="$1"
    local status_code="$2"
    local limit="$3"
    local remaining="$4"
    local reset="$5"
    local period="$6"
    local retry_after="$7"
    local response_time="$8"
    
    jq -n \
       --arg rn "$request_num" \
       --arg sc "$status_code" \
       --arg l "${limit:-N/A}" \
       --arg r "${remaining:-N/A}" \
       --arg rs "$(format_date "$reset")" \
       --arg p "${period:-N/A}" \
       --arg ra "${retry_after:-N/A}" \
       --arg rt "${response_time}" \
       '{request_num: $rn, status_code: $sc, limit: $l, remaining: $r, reset: $rs, period: $p, retry_after: $ra, response_time: $rt}'
}

# Function to display results in CSV format
display_csv() {
    local request_num="$1"
    local status_code="$2"
    local limit="$3"
    local remaining="$4"
    local reset="$5"
    local period="$6"
    local retry_after="$7"
    local response_time="$8"
    
    echo "$request_num,$status_code,${limit:-N/A},${remaining:-N/A},$(format_date "$reset"),${period:-N/A},${retry_after:-N/A},$response_time"
}

# Function for statistical analysis
calculate_stats() {
    local -n times=$1
    local -n codes=$2
    
    # Calculate average response time
    local sum=0
    for time in "${times[@]}"; do
        sum=$((sum + time))
    done
    local avg=$((sum / ${#times[@]}))
    
    # Calculate success rate
    local success=0
    for code in "${codes[@]}"; do
        if [[ $code -ge 200 && $code -lt 300 ]]; then
            ((success++))
        fi
    done
    local success_rate=$(bc <<< "scale=2; $success / ${#codes[@]} * 100")
    
    echo "Average Response Time: ${avg}ms"
    echo "Success Rate: ${success_rate}%"
}

# Function for ASCII chart
generate_chart() {
    local -n times=$1
    local -n codes=$2
    local max_height=20
    local width=${#times[@]}
    
    for ((i=0; i<max_height; i++)); do
        for ((j=0; j<width; j++)); do
            if [[ ${codes[j]} -eq 200 ]]; then
                if (( (max_height - i) <= times[j] / 20 )); then
                    echo -n "█"
                else
                    echo -n " "
                fi
            else
                if (( (max_height - i) <= 1 )); then
                    echo -n "▄"
                else
                    echo -n " "
                fi
            fi
        done
        echo
    done
    echo "$(printf '%0.s-' $(seq 1 $width))"
    echo "Success (█) vs Rate Limited (▄)"
}

# Display header based on output format
case $OUTPUT_FORMAT in
    table)
        echo -e "${YELLOW}Rate Limiter Test Results for $URL${NC}"
        echo -e "${YELLOW}Requests: $REQUESTS, Delay: ${DELAY:-No} seconds${NC}"
        printf "| %-8s | %-11s | %-5s | %-9s | %-19s | %-6s | %-10s | %-8s |\n" \
               "Request" "Status Code" "Limit" "Remaining" "Reset Time" "Period" "Retry After" "Response"
        echo "|----------|-------------|-------|-----------|---------------------|--------|------------|----------|"
        ;;
    json)
        echo "["
        ;;
    csv)
        echo "Request,Status Code,Limit,Remaining,Reset Time,Period,Retry After,Response Time"
        ;;
esac

# Prepare curl command
CURL_CMD="curl -i -s -H 'Accept: application/json'"
for header in "${CUSTOM_HEADERS[@]}"; do
    CURL_CMD+=" -H '$header'"
done
CURL_CMD+=" -m $TIMEOUT"
if $FOLLOW_REDIRECTS; then
    CURL_CMD+=" -L"
fi

# Arrays to store response times and status codes
response_times=()
status_codes=()

# Main loop
for i in $(seq 1 $REQUESTS); do
    # Send request and capture full response (headers and body)
    start_time=$(date +%s%N)
    response=$(eval $CURL_CMD "$URL")
    end_time=$(date +%s%N)
    response_time=$(( (end_time - start_time) / 1000000 ))
    
    # Extract status code
    status_code=$(echo "$response" | grep -i "HTTP/" | tail -n1 | awk '{print $2}')
    
    # Extract headers
    headers=$(echo "$response" | sed -n '1,/^\r$/p')
    
    # Extract body
    body=$(echo "$response" | sed '1,/^\r$/d')
    
    # Parse rate limit headers
    IFS='|' read -r limit remaining reset period retry_after <<< $(parse_headers "$headers")
    
    # Store response time and status code
    response_times+=($response_time)
    status_codes+=($status_code)
    
    # Display results based on output format
    case $OUTPUT_FORMAT in
        table)
            if [ "$status_code" = "429" ]; then
                status_color="${RED}"
            elif [ "$remaining" = "0" ]; then
                status_color="${YELLOW}"
            else
                status_color="${GREEN}"
            fi
            echo -e "${status_color}$(display_table "$i" "$status_code" "$limit" "$remaining" "$reset" "$period" "$retry_after" "$response_time")${NC}"
            ;;
        json)
            display_json "$i" "$status_code" "$limit" "$remaining" "$reset" "$period" "$retry_after" "$response_time"
            [ $i -lt $REQUESTS ] && echo ","
            ;;
        csv)
            display_csv "$i" "$status_code" "$limit" "$remaining" "$reset" "$period" "$retry_after" "$response_time"
            ;;
    esac
    
    # Display verbose information if requested
    if $VERBOSE; then
        echo -e "\n${BLUE}Request $i Details:${NC}"
        echo -e "${YELLOW}All Headers:${NC}"
        echo "$headers"
        echo -e "${YELLOW}Response Body:${NC}"
        echo "$body" | jq '.' 2>/dev/null || echo "$body"
        echo -e "${BLUE}------------------------${NC}"
    fi
    
    # Delay before next request (if specified)
    [ "$DELAY" != "0" ] && sleep $DELAY
done

# Close JSON array if using JSON output
[ "$OUTPUT_FORMAT" = "json" ] && echo "]"

# Display statistics and chart
echo -e "\n${BLUE}Test Statistics:${NC}"
calculate_stats response_times status_codes

echo -e "\n${BLUE}Request Visualization:${NC}"
generate_chart response_times status_codes

echo -e "\n${GREEN}Test completed.${NC}"
