# Rate Limiting Worker

## Overview

The Rate Limiting Worker is a Cloudflare Worker that implements a flexible and configurable rate limiting system. It processes incoming requests, applies rate limiting rules, and takes appropriate actions when limits are exceeded.

## Features

- Applies complex rate limiting rules to incoming requests
- Supports various methods of client identification (IP, custom headers, etc.)
- Implements configurable actions for rate limit violations
- Provides real-time rate limit information
- Integrates with Cloudflare's edge network for optimal performance

## Architecture

The Rate Limiting Worker is built using JavaScript and runs on Cloudflare's edge network. It uses Cloudflare's Durable Objects for both distributed state management and configuration storage, ensuring consistency and high performance across the global network.

### Key Components

1. **Main Worker (index.js)**: Handles incoming requests and orchestrates the rate limiting process.
2. **Rate Limiter (rate-limiter.js)**: Implements core rate limiting logic.
3. **Config Storage (config-storage.js)**: Manages retrieval and caching of rate limiting rules using Durable Objects.
4. **Fingerprint Generator (fingerprint.js)**: Creates unique identifiers for requests.
5. **Condition Evaluator (condition-evaluator.js)**: Evaluates complex matching conditions.

## Workflow

1. The Worker receives an incoming request.
2. It fetches the current rate limiting configuration from the Config Storage Durable Object.
3. The request is evaluated against the configured rules.
4. If a matching rule is found:
   - A fingerprint is generated for the request.
   - The rate limit is checked for the fingerprint using the Rate Limiter Durable Object.
   - If the limit is exceeded, the configured action is taken.
   - If not, the request is allowed to proceed.
5. Rate limit headers are added to the response.

## Configuration

The Worker uses a JSON configuration stored in a Durable Object that defines rate limiting rules. Each rule includes:

- Basic information (name, description)
- Matching conditions
- Fingerprinting settings
- Rate limit details (requests per time period)
- Actions for when limits are exceeded

## Integration with Rate Limiting UI

The Worker fetches its configuration from a Durable Object that is updated by the Rate Limiting UI. This allows for dynamic updates to rate limiting rules without redeploying the Worker.

## Performance Considerations

- The Worker uses in-memory caching to minimize latency in fetching configurations.
- Durable Objects ensure consistent rate limiting and configuration storage across Cloudflare's global network.
- Efficient request evaluation and fingerprinting minimize processing time.

## Extending the Worker

The Worker is designed to be modular and extensible. Possible extensions include:
- Support for more complex rate limiting algorithms
- Integration with external data sources for dynamic rate limiting
- Custom actions for rate limit violations

## Deployment

1. Ensure Cloudflare Workers are set up for your domain.
2. Configure the necessary Durable Objects for both rate limiting state and configuration storage.
3. Deploy the Worker code to your Cloudflare account.
4. Set up the required environment variables:
   - `CONFIG_STORAGE`: Durable Object namespace for configuration storage
   - `RATE_LIMITER`: Durable Object namespace for rate limiting state
   - `RATE_LIMIT_INFO_PATH`: Path for accessing rate limit information

## Monitoring and Troubleshooting

- Use Cloudflare's Workers dashboard to monitor invocations and errors.
- Enable debug logging for detailed information on rule evaluation and rate limiting decisions.
- Check the Worker's logs for any configuration parsing errors or unexpected behaviors.
- Monitor Durable Object usage and performance in the Cloudflare dashboard.

## Security Considerations

- The Worker never exposes sensitive configuration details in responses.
- All communication with Durable Objects is internal to Cloudflare's network and encrypted.
- The Worker implements safeguards against potential DoS vectors in the rate limiting logic.
- Access to the configuration Durable Object is strictly controlled to prevent unauthorized modifications.

## Durable Objects Usage

- **Config Storage**: A single Durable Object instance stores the entire rate limiting configuration. This ensures atomic updates and consistent reads across all Worker instances.
- **Rate Limiter**: Multiple Durable Object instances are used to store rate limiting state, keyed by client identifiers. This allows for distributed yet consistent rate limiting across Cloudflare's global network.

For more detailed information on the Rate Limiting Worker's internals and API, please refer to the technical documentation.
