let cachedConfig = null;
let lastConfigFetch = 0;
// const CONFIG_CACHE_TTL = 5 * 1000;
// let isRefreshing = false;

export async function getConfig(env) {
  if (!cachedConfig) {
    await fetchAndUpdateConfig(env);
  }
  return cachedConfig;
}

async function fetchAndUpdateConfig(env) {
  try {
    const configStorageId = env.CONFIG_STORAGE.idFromName("global");
    const configStorage = env.CONFIG_STORAGE.get(configStorageId);
    const configResponse = await configStorage.fetch(
      new Request("https://rate-limiter-configurator/config"),
    );
    if (!configResponse.ok) {
      throw new Error(
        `Failed to fetch config: ${configResponse.status} ${configResponse.statusText}`,
      );
    }
    const config = await configResponse.json();
    console.log("Fetched config:", JSON.stringify(config, null, 2));
    if (!config || !Array.isArray(config.rules) || config.rules.length === 0) {
      console.warn("Config is empty or invalid");
      return null;
    }
    cachedConfig = config;
    lastConfigFetch = Date.now();
    console.log(`New config fetched and cached at ${lastConfigFetch}`);
    return cachedConfig;
  } catch (error) {
    console.error("Error fetching config:", error);
    return null;
  }
}

// export async function backgroundRefresh(env) {
//   if (isRefreshing) return;
//   isRefreshing = true;
//
//   while (true) {
//     try {
//       const now = Date.now();
//       if (now - lastConfigFetch >= CONFIG_CACHE_TTL) {
//         console.log("Background refresh: Fetching new config...");
//         await fetchAndUpdateConfig(env);
//       } else {
//         console.log("Background refresh: Config is still fresh");
//       }
//     } catch (error) {
//       console.error("Error in background refresh:", error);
//     }
//     await new Promise((resolve) => setTimeout(resolve, 5000));
//   }
// }

export function isValidRuleStructure(rule) {
  if (!rule.initialMatch) {
    console.warn(`Rule ${rule.name} is missing initialMatch`);
    return false;
  }
  if (rule.elseIfActions && rule.elseIfActions.length > 0 && !rule.elseAction) {
    console.warn(`Rule ${rule.name} has elseIfActions but no elseAction`);
    return false;
  }
  return true;
}
