// Test-only CommonJS preload. Next normally reads local .env files even when public settings
// were supplied explicitly. Replace its env loader BEFORE loading Next so these
// isolated browser tests never read local secrets. Production is unaffected.
const id = require.resolve('@next/env')
// Synchronous CommonJS preload must run before Next imports this module.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const original = require(id)
require.cache[id].exports = {
  ...original,
  loadEnvConfig: () => ({ combinedEnv: process.env, parsedEnv: {}, loadedEnvFiles: [] }),
}
