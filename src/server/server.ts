/* eslint-disable eslint-plugin-n/no-unsupported-features/node-builtins */

import type { ServerConfig } from './types.js'
import type { SessionManager } from './sessionManager.js'
import type { ServerLogger } from './serverLog.js'

type StartedServer = {
  port?: number
  stop: (closeActiveConnections?: boolean) => void
}

function unauthorized(): Response {
  return new Response('Unauthorized', { status: 401 })
}

function notFound(): Response {
  return new Response('Not found', { status: 404 })
}

function badRequest(message: string): Response {
  return new Response(message, { status: 400 })
}

function isAuthorized(req: Request, authToken?: string): boolean {
  if (!authToken) {
    return true
  }
  const raw = req.headers.get('authorization')
  if (!raw || !raw.toLowerCase().startsWith('bearer ')) {
    return false
  }
  const token = raw.slice(7)
  return token === authToken
}

function getWsUrl(req: Request, config: ServerConfig, sessionId: string): string {
  if (config.unix) {
    return `/sessions/${sessionId}/ws`
  }
  const reqUrl = new URL(req.url)
  const proto = reqUrl.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${reqUrl.host}/sessions/${sessionId}/ws`
}

async function parseCreateBody(req: Request): Promise<{
  cwd?: string
  dangerously_skip_permissions?: boolean
}> {
  try {
    return (await req.json()) as {
      cwd?: string
      dangerously_skip_permissions?: boolean
    }
  } catch {
    return {}
  }
}

function parseOptionalNumberParam(
  raw: string | null,
  name: string,
): number | undefined {
  if (raw === null) {
    return undefined
  }
  const parsed = Number.parseInt(raw, 10)
  if (Number.isNaN(parsed) || parsed < 0) {
    throw new Error(`Invalid ${name}: expected a non-negative integer`)
  }
  return parsed
}

export function startServer(
  config: ServerConfig,
  sessionManager: SessionManager,
  logger: ServerLogger,
): StartedServer {
  sessionManager.setLogger(logger)

  const fetchHandler: Bun.Serve.Options<{ sessionId: string }>['fetch'] = async (req, srv) => {
    const url = new URL(req.url)

    if (url.pathname === '/health') {
      return new Response('ok')
    }

    if (url.pathname === '/sessions') {
      if (!isAuthorized(req, config.authToken)) {
        return unauthorized()
      }

      if (req.method === 'GET') {
        try {
          const sessions = await sessionManager.listSessions({
            cwd: url.searchParams.get('cwd') ?? undefined,
            limit: parseOptionalNumberParam(url.searchParams.get('limit'), 'limit'),
            offset: parseOptionalNumberParam(url.searchParams.get('offset'), 'offset'),
          })

          return new Response(JSON.stringify({ sessions }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        } catch (error) {
          return badRequest(
            error instanceof Error ? error.message : 'Invalid session query',
          )
        }
      }

      if (req.method === 'POST') {
        const body = await parseCreateBody(req)
        const cwd = body.cwd || config.workspace || process.cwd()

        try {
          const created = await sessionManager.createSession({
            cwd,
            dangerouslySkipPermissions: body.dangerously_skip_permissions,
          })

          return new Response(
            JSON.stringify({
              session_id: created.id,
              ws_url: getWsUrl(req, config, created.id),
              work_dir: created.workDir,
            }),
            {
              status: 200,
              headers: { 'content-type': 'application/json' },
            },
          )
        } catch (error) {
          logger.error(`failed to create session: ${String(error)}`)
          return new Response('Unable to create session', { status: 503 })
        }
      }
    }

    if (url.pathname.startsWith('/sessions/') && req.method === 'GET' && !url.pathname.endsWith('/ws')) {
      if (!isAuthorized(req, config.authToken)) {
        return unauthorized()
      }

      const parts = url.pathname.split('/').filter(Boolean)
      if (parts.length !== 2 || parts[0] !== 'sessions') {
        return notFound()
      }

      const sessionId = parts[1]
      if (!sessionId) {
        return notFound()
      }

      const messages = await sessionManager.getSessionRecords(
        sessionId,
        url.searchParams.get('cwd') ?? undefined,
      )
      if (!messages) {
        return notFound()
      }

      return new Response(JSON.stringify({ session_id: sessionId, messages, records: messages }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }

    if (url.pathname.startsWith('/sessions/') && url.pathname.endsWith('/ws')) {
      if (!isAuthorized(req, config.authToken)) {
        return unauthorized()
      }

      const parts = url.pathname.split('/')
      const sessionId = parts[2]
      if (!sessionId || !(await sessionManager.ensureSession(sessionId))) {
        return notFound()
      }

      const upgraded = srv.upgrade(req, {
        data: { sessionId },
      })
      if (!upgraded) {
        return new Response('WebSocket upgrade failed', { status: 400 })
      }
      return undefined
    }

    return notFound()
  }

  const websocketHandler: Bun.WebSocketHandler<{ sessionId: string }> = {
    open: ws => {
      const sessionId = ws.data.sessionId
      const ok = sessionManager.attachClient(sessionId, ws)
      if (!ok) {
        ws.close(1008, 'unknown session')
      }
    },
    message: (ws, message) => {
      const sessionId = ws.data.sessionId
      const payload = typeof message === 'string' ? message : Buffer.from(message).toString('utf8')
      sessionManager.ingestClientMessage(sessionId, payload)
    },
    close: ws => {
      const sessionId = ws.data.sessionId
      sessionManager.detachClient(sessionId, ws)
    },
  }

  const server = config.unix
    ? Bun.serve<{ sessionId: string }>({
        unix: config.unix,
        fetch: fetchHandler,
        websocket: websocketHandler,
      })
    : Bun.serve<{ sessionId: string }>({
        port: config.port,
        hostname: config.host,
        fetch: fetchHandler,
        websocket: websocketHandler,
      })

  logger.info(
    config.unix
      ? `listening on unix socket ${config.unix}`
      : `listening on http://${config.host}:${server.port}`,
  )

  return {
    port: server.port,
    stop(closeActiveConnections = false) {
      server.stop(closeActiveConnections)
    },
  }
}
