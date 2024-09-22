# Rate Limiting Worker

## Overview

The Rate Limiting Worker is a Cloudflare Worker designed to implement rate limiting based on configurable rules. It works in conjunction with the Rate Limit Configurator UI, fetching rules from a shared Durable Object and applying them to incoming requests.

## Project Structure

```
do-rl-worker/
├── src/
│   ├── config-storage.js
│   ├── condition-evaluator.js
│   ├── fingerprint.js
│   ├── index.js
│   ├── rate-limiter.js
│   ├── staticpages.js
│   └── utils.js
├── package.json
└── wrangler.toml
```

## Key Components

1. **index.js**: The main entry point for the worker. It handles incoming requests, fetches the configuration, finds matching rules, and applies rate limiting.

2. **config-storage.js**: Defines the `ConfigStorage` class, a Durable Object responsible for storing and managing rate limiting rules.

3. **rate-limiter.js**: Contains the `RateLimiter` class, which implements the core rate limiting logic.

4. **condition-evaluator.js**: Provides functions for evaluating conditions defined in the rate limiting rules.

5. **fingerprint.js**: Handles the generation of unique identifiers for requests based on configured parameters.

6. **staticpages.js**: Serves static HTML pages for rate limit notifications and information.

7. **utils.js**: Contains utility functions for cryptographic operations.

## Workflow

1. The worker receives an incoming request.
2. It fetches the current configuration from the `ConfigStorage` Durable Object.
3. The worker finds the first matching rule based on the request properties.
4. If a matching rule is found, the worker applies the rate limiting logic using the `RateLimiter` Durable Object.
5. Based on the rate limiting result and the rule's action, the worker either allows the request to proceed, blocks it, or applies a custom action.

## Rate Limiting Logic

The rate limiting is based on a sliding window algorithm. Each client is identified by a unique fingerprint generated from configurable request properties. The worker tracks the number of requests made by each client within the specified time window.

## Configuration

The rate limiting rules are stored in and fetched from a `ConfigStorage` Durable Object. Each rule can specify:

- Rate limit (requests per time period)
- Fingerprint parameters
- Matching conditions
- Actions to take when rate limit is exceeded

## API Endpoints

The worker handles the following special endpoints:

- `/_ratelimit`: Returns information about the current rate limit status for the client.
- `/config`: Proxies requests to the `ConfigStorage` Durable Object for rule management.

## Durable Objects

The worker uses two types of Durable Objects:

1. **ConfigStorage**: Stores and manages the rate limiting rules.
2. **RateLimiter**: Implements the rate limiting logic for each unique client identifier.

## Deployment

To deploy the worker:

1. Ensure you have the Wrangler CLI installed and authenticated with your Cloudflare account.
2. Run `wrangler publish` in the project directory.

## Configuration (wrangler.toml)

The `wrangler.toml` file contains important configuration details:

- Worker name and compatibility date
- Route configuration
- Durable Object bindings

Ensure that the Durable Object bindings match those in the UI project for proper integration.

## Development

To run the worker locally for development:

```
wrangler dev
```

This command starts a local development server that simulates the Cloudflare Workers environment.

## Testing

Currently, the project does not have a formal testing setup. It's recommended to implement unit tests for critical components like the condition evaluator and rate limiting logic.

## Error Handling and Logging

The worker includes extensive logging throughout its execution. In production, these logs can be viewed in the Cloudflare dashboard. Errors are caught and logged, with the worker attempting to gracefully handle failures by passing through requests when errors occur.

## Security Considerations

- Ensure that the worker is deployed with appropriate access controls to prevent unauthorized manipulation of rate limiting rules.
- The worker trusts headers like `true-client-ip` and `cf-connecting-ip` for client identification. Ensure these are set correctly in your Cloudflare configuration.
- Consider implementing additional security measures such as API key validation for the configuration endpoints.

## Integration with UI

This worker is designed to work in tandem with the Rate Limit Configurator UI. The UI manages the rules stored in the `ConfigStorage` Durable Object, which this worker then fetches and applies.

## Limitations

- The current implementation has a hard-coded body size limit for fingerprinting and condition evaluation.
- The configuration is cached for 1 minute to reduce Durable Object reads. This means that rule changes may take up to 1 minute to propagate.

## Future Improvements

- Implement more sophisticated caching mechanisms for configuration and rate limit data.
- Add support for more complex rate limiting scenarios, such as tiered limits or dynamic limits based on user behavior.
- Enhance the fingerprinting capabilities to support more complex client identification schemes.
