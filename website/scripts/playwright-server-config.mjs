export const DEFAULT_PLAYWRIGHT_PORT = 4322;
export const PLAYWRIGHT_HOST = '127.0.0.1';

/**
 * @param {Record<string, string | undefined>} [environment]
 */
export function resolvePlaywrightServerConfig(environment = process.env) {
  const rawPort = environment.PLAYWRIGHT_PORT;

  if (rawPort === undefined) {
    return serverConfig(DEFAULT_PLAYWRIGHT_PORT);
  }

  if (!/^\d+$/.test(rawPort)) {
    throw new Error(
      `Invalid PLAYWRIGHT_PORT ${JSON.stringify(rawPort)}: expected decimal digits only for an integer from 1 to 65535.`,
    );
  }

  const port = Number(rawPort);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid PLAYWRIGHT_PORT ${JSON.stringify(rawPort)}: expected an integer from 1 to 65535.`);
  }

  return serverConfig(port);
}

/** @param {number} port */
function serverConfig(port) {
  return Object.freeze({
    host: PLAYWRIGHT_HOST,
    origin: new URL(`http://${PLAYWRIGHT_HOST}:${port}`).origin,
    port,
  });
}
