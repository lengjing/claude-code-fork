export type ParsedConnectUrl = {
  serverUrl: string
  authToken?: string
}

function parseUnixUrl(input: string): ParsedConnectUrl {
  const url = new URL(input)
  const authToken =
    url.searchParams.get('authToken') ??
    url.searchParams.get('token') ??
    undefined

  const socketPath = decodeURIComponent(`${url.hostname}${url.pathname}`)
  if (!socketPath) {
    throw new Error('Invalid cc+unix URL: missing socket path')
  }

  return {
    // Internal transport marker. Callers convert this to Bun fetch/ws unix options.
    serverUrl: `unix:${socketPath}`,
    authToken,
  }
}

function parseTcpUrl(input: string): ParsedConnectUrl {
  const url = new URL(input)
  const authToken =
    url.searchParams.get('authToken') ??
    url.searchParams.get('token') ??
    undefined

  if (!url.hostname || !url.port) {
    throw new Error('Invalid cc URL: host and port are required')
  }

  return {
    serverUrl: `http://${url.hostname}:${url.port}`,
    authToken,
  }
}

export function parseConnectUrl(input: string): ParsedConnectUrl {
  if (input.startsWith('cc+unix://')) {
    return parseUnixUrl(input)
  }

  if (!input.startsWith('cc://')) {
    throw new Error('Invalid connect URL: expected cc:// or cc+unix://')
  }

  return parseTcpUrl(input)
}
