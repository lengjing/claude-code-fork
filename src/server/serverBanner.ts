import type { ServerConfig } from './types.js'

function getConnectHost(host: string): string {
  if (host === '0.0.0.0') {
    return '127.0.0.1'
  }
  return host
}

export function printBanner(
  config: ServerConfig,
  authToken: string | undefined,
  actualPort: number,
): void {
  process.stderr.write(`Claude Code server started\n`)

  if (config.unix) {
    process.stderr.write(`Socket: ${config.unix}\n`)
    const connectUrl = authToken
      ? `cc+unix://${encodeURIComponent(config.unix)}?authToken=${encodeURIComponent(authToken)}`
      : `cc+unix://${encodeURIComponent(config.unix)}`
    process.stderr.write(`Connect URL: ${connectUrl}\n`)
  } else {
    const host = getConnectHost(config.host)
    process.stderr.write(`HTTP: http://${config.host}:${actualPort}\n`)
    const connectUrl = authToken
      ? `cc://${host}:${actualPort}?authToken=${encodeURIComponent(authToken)}`
      : `cc://${host}:${actualPort}`
    process.stderr.write(`Connect URL: ${connectUrl}\n`)
  }

  if (!authToken) {
    process.stderr.write('Auth: disabled (--no-auth)\n')
  }

  process.stderr.write(`Use \"claude open <cc-url>\" to connect in headless mode.\n`)
}
