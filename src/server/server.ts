/* eslint-disable eslint-plugin-n/no-unsupported-features/node-builtins */

import { z } from 'zod/v4'
import type { ServerConfig } from './types.js'
import type { SessionManager } from './sessionManager.js'
import type { ServerLogger } from './serverLog.js'
import { getWebUIHtml } from './webUI.ts'

type StartedServer = {
  port?: number
  stop: (closeActiveConnections?: boolean) => void
}

const listSessionsQuerySchema = z.object({
  cwd: z.string().min(1).optional(),
  limit: z.coerce.number().int().nonnegative().optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
})

const createSessionBodySchema = z.object({
  cwd: z.string().min(1).optional(),
  dangerously_skip_permissions: z.boolean().optional(),
})

type SessionRoute =
  | { kind: 'collection' }
  | { kind: 'records'; sessionId: string }
  | { kind: 'ws'; sessionId: string }
  | null

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

function errorResponse(
  status: number,
  code: string,
  message: string,
): Response {
  return jsonResponse(
    {
      error: {
        code,
        message,
      },
    },
    status,
  )
}

function unauthorized(): Response {
  return errorResponse(401, 'UNAUTHORIZED', 'Unauthorized')
}

function notFound(): Response {
  return errorResponse(404, 'NOT_FOUND', 'Not found')
}

function badRequest(message: string, code = 'BAD_REQUEST'): Response {
  return errorResponse(400, code, message)
}

function isAuthorized(req: Request, authToken?: string): boolean {
  if (!authToken) {
    return true
  }
  // Check Authorization header first
  const raw = req.headers.get('authorization')
  if (raw && raw.toLowerCase().startsWith('bearer ')) {
    return raw.slice(7) === authToken
  }
  // Fall back to ?token= query parameter (needed for browser WebSocket which
  // cannot set custom headers).
  const urlObj = new URL(req.url)
  const queryToken = urlObj.searchParams.get('token')
  return queryToken === authToken
}

function getWsUrl(req: Request, config: ServerConfig, sessionId: string): string {
  if (config.unix) {
    return `/sessions/${sessionId}/ws`
  }
  const reqUrl = new URL(req.url)
  const proto = reqUrl.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${reqUrl.host}/sessions/${sessionId}/ws`
}

async function parseJsonBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const parsed = await req.json()
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

function parseRoute(pathname: string): SessionRoute {
  const parts = pathname.split('/').filter(Boolean)
  if (parts.length === 1 && parts[0] === 'sessions') {
    return { kind: 'collection' }
  }
  if (parts.length === 2 && parts[0] === 'sessions' && parts[1]) {
    return { kind: 'records', sessionId: parts[1] }
  }
  if (parts.length === 3 && parts[0] === 'sessions' && parts[2] === 'ws' && parts[1]) {
    return { kind: 'ws', sessionId: parts[1] }
  }
  return null
}

function getListSessionsQuery(url: URL):
  | {
      ok: true
      value: {
        cwd?: string
        limit?: number
        offset?: number
      }
    }
  | { ok: false; error: string } {
  const parsed = listSessionsQuerySchema.safeParse({
    cwd: url.searchParams.get('cwd') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined,
    offset: url.searchParams.get('offset') ?? undefined,
  })
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.map(issue => issue.message).join('; '),
    }
  }
  return { ok: true, value: parsed.data }
}

async function getCreateSessionBody(req: Request): Promise<
  | {
      ok: true
      value: {
        cwd?: string
        dangerously_skip_permissions?: boolean
      }
    }
  | { ok: false; error: string }
> {
  const body = await parseJsonBody(req)
  const parsed = createSessionBodySchema.safeParse(body)
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.map(issue => issue.message).join('; '),
    }
  }
  return { ok: true, value: parsed.data }
}

async function ensureSessionReady(
  sessionId: string,
  cwd: string | undefined,
  config: ServerConfig,
  sessionManager: SessionManager,
  logger: ServerLogger,
): Promise<{ ok: true } | { ok: false; response: Response }> {
  if (await sessionManager.ensureSession(sessionId)) {
    return { ok: true }
  }

  try {
    await sessionManager.wakeSession({
      sessionId,
      cwd: cwd ?? config.workspace,
    })
    return { ok: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.startsWith('Session not found:')) {
      return { ok: false, response: notFound() }
    }
    logger.error(`failed to auto-wake session ${sessionId}: ${message}`)
    return {
      ok: false,
      response: errorResponse(503, 'SESSION_RESTORE_FAILED', 'Unable to restore session'),
    }
  }
}

export function startServer(
  config: ServerConfig,
  sessionManager: SessionManager,
  logger: ServerLogger,
): StartedServer {
  sessionManager.setLogger(logger)

  // Lazily compute web UI HTML so it is only generated when web mode is on.
  let webUIHtmlCache: string | null = null
  const getWebUI = (): string => {
    if (webUIHtmlCache === null) {
      webUIHtmlCache = getWebUIHtml(config.authToken)
    }
    return webUIHtmlCache
  }

  const fetchHandler: Bun.Serve.Options<{ sessionId: string }>['fetch'] = async (req, srv) => {
    const url = new URL(req.url)
    const route = parseRoute(url.pathname)

    if (url.pathname === '/health') {
      return new Response('ok')
    }

    // Serve the web UI at the root path when webUI is enabled.
    if (config.webUI && (url.pathname === '/' || url.pathname === '/chat')) {
      return new Response(getWebUI(), {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      })
    }

    if (route?.kind === 'collection') {
      if (!isAuthorized(req, config.authToken)) {
        return unauthorized()
      }

      if (req.method === 'GET') {
        const query = getListSessionsQuery(url)
        if (query.ok === false) {
          return badRequest(query.error, 'INVALID_QUERY')
        }

        const sessions = await sessionManager.listSessions(query.value)
        return jsonResponse({ sessions })
      }

      if (req.method === 'POST') {
        const bodyResult = await getCreateSessionBody(req)
        if (bodyResult.ok === false) {
          return badRequest(bodyResult.error, 'INVALID_BODY')
        }
        const body = bodyResult.value
        const cwd = body.cwd || config.workspace || process.cwd()

        try {
          const created = await sessionManager.createSession({
            cwd,
            dangerouslySkipPermissions: body.dangerously_skip_permissions,
          })
          return jsonResponse({
            session_id: created.id,
            ws_url: getWsUrl(req, config, created.id),
            work_dir: created.workDir,
          })
        } catch (error) {
          logger.error(`failed to create session: ${String(error)}`)
          return errorResponse(503, 'SESSION_CREATE_FAILED', 'Unable to create session')
        }
      }

      return notFound()
    }

    if (route?.kind === 'records' && req.method === 'GET') {
      if (!isAuthorized(req, config.authToken)) {
        return unauthorized()
      }
      const sessionId = route.sessionId

      const messages = await sessionManager.getSessionRecords(
        sessionId,
        url.searchParams.get('cwd') ?? undefined,
      )
      if (!messages) {
        return notFound()
      }

      return jsonResponse({
        session_id: sessionId,
        messages,
        records: messages,
      })
    }

    if (route?.kind === 'ws') {
      if (!isAuthorized(req, config.authToken)) {
        return unauthorized()
      }
      const sessionId = route.sessionId

      const readiness = await ensureSessionReady(
        sessionId,
        url.searchParams.get('cwd') ?? undefined,
        config,
        sessionManager,
        logger,
      )
      if (readiness.ok === false) {
        return readiness.response
      }

      const upgraded = srv.upgrade(req, {
        data: { sessionId },
      })
      if (!upgraded) {
        return badRequest('WebSocket upgrade failed', 'WS_UPGRADE_FAILED')
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
