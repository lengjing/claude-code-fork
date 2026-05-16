/* eslint-disable eslint-plugin-n/no-unsupported-features/node-builtins */

import { appendFile, mkdir } from 'fs/promises'
import { dirname, join } from 'path'
import type { SessionInfo } from '../utils/listSessionsImpl.js'
import { listSessionsImpl } from '../utils/listSessionsImpl.js'
import { loadTranscriptFile } from '../utils/sessionStorage.js'
import {
  getProjectDir,
  resolveSessionFilePath,
} from '../utils/sessionStoragePortable.js'
import type { ServerSessionProcess } from './runtimeState.js'
import type { ServerLogger } from './serverLog.js'

export type SessionBackend = {
  spawnSession(opts: {
    cwd: string
    dangerouslySkipPermissions?: boolean
    resumeSessionId?: string
  }): Promise<{ child: ServerSessionProcess; workDir: string }>
}

export type ListedSession = SessionInfo & {
  /**
   * API-facing session projection used by list endpoints and web UI.
   * This type must remain serializable and never hold process/socket handles.
   */
  active: boolean
  attachedClients: number
  status: 'running' | 'detached' | 'persisted'
  lastActiveAt?: number
}

/**
 * Callback invoked for each JSON line broadcast from a session.
 * Used by the dashboard SSE handler to relay events to browser clients.
 */
export type SessionLineSubscriber = (sessionId: string, line: string) => void

type ActiveSession = {
  /**
   * Runtime-only session state held in memory while server is alive.
   * Owns child process, attached websocket clients, timers, and write queue.
   */
  id: string
  workDir: string
  createdAt: number
  lastActiveAt: number
  clients: Set<Bun.ServerWebSocket<{ sessionId: string }>>
  child: ServerSessionProcess
  idleTimer: ReturnType<typeof setTimeout> | null
  /**
   * Serial write chain — all disk appends are chained here so they
   * execute in order without races.  ws.send() is always deferred until
   * after the corresponding disk write completes.
   */
  pendingWrite: Promise<void>
}

function sessionFilePath(session: ActiveSession): string {
  return join(getProjectDir(session.workDir), `${session.id}.jsonl`)
}

function sessionStatus(clientCount: number): 'running' | 'detached' {
  return clientCount > 0 ? 'running' : 'detached'
}

function parseStructuredLine(line: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(line) as unknown
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

function extractSessionIdFromLine(line: string): string | null {
  const parsed = parseStructuredLine(line)
  if (typeof parsed?.session_id === 'string' && parsed.session_id.length > 0) {
    return parsed.session_id
  }

  const response = parsed?.response as Record<string, unknown> | undefined
  if (response?.subtype === 'success') {
    const successPayload = response.response as Record<string, unknown> | undefined
    if (
      typeof successPayload?.session_id === 'string' &&
      successPayload.session_id.length > 0
    ) {
      return successPayload.session_id
    }
  }

  return null
}

function extractUserText(msg: Record<string, unknown>): string {
  // Simplified format: { type: 'user', text: '...' }
  if (typeof msg.text === 'string') return msg.text

  // SDK format: { type: 'user', message: { role: 'user', content: [...] } }
  const message = msg.message as Record<string, unknown> | undefined
  if (!message) return ''
  const content = message.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    for (const block of content as Record<string, unknown>[]) {
      if (block.type === 'text' && typeof block.text === 'string') {
        return block.text
      }
    }
  }
  return ''
}

export class SessionManager {
  private readonly sessions = new Map<string, ActiveSession>()
  private logger: ServerLogger | null = null
  /**
   * Global subscribers that receive every broadcast line from any session.
   * The dashboard SSE handler registers here to relay events to browsers.
   */
  private readonly lineSubscribers = new Set<SessionLineSubscriber>()

  constructor(
    private readonly backend: SessionBackend,
    private readonly options: {
      idleTimeoutMs?: number
      maxSessions?: number
    } = {},
  ) {}

  setLogger(logger: ServerLogger): void {
    this.logger = logger
  }

  /**
   * Register a subscriber that is called for every JSON line broadcast from
   * any session.  Returns a dispose function to unregister.
   */
  subscribeLines(subscriber: SessionLineSubscriber): () => void {
    this.lineSubscribers.add(subscriber)
    return () => {
      this.lineSubscribers.delete(subscriber)
    }
  }

  async createSession(opts: {
    cwd: string
    dangerouslySkipPermissions?: boolean
  }): Promise<{ id: string; workDir: string }> {
    const maxSessions = this.options.maxSessions ?? 0
    if (maxSessions > 0 && this.sessions.size >= maxSessions) {
      throw new Error(`Maximum number of sessions (${maxSessions}) reached`)
    }

    const { child, workDir } = await this.backend.spawnSession(opts)
    const session = await this.initializeSession(child, workDir)

    return { id: session.id, workDir }
  }

  async wakeSession(opts: {
    sessionId: string
    cwd?: string
    dangerouslySkipPermissions?: boolean
  }): Promise<{ id: string; workDir: string; resumed: boolean }> {
    const active = this.sessions.get(opts.sessionId)
    if (active) {
      this.clearIdleTimer(active)
      this.markSessionActive(active)
      return { id: active.id, workDir: active.workDir, resumed: false }
    }

    const maxSessions = this.options.maxSessions ?? 0
    if (maxSessions > 0 && this.sessions.size >= maxSessions) {
      throw new Error(`Maximum number of sessions (${maxSessions}) reached`)
    }

    const resolved = await resolveSessionFilePath(opts.sessionId, opts.cwd)
    if (!resolved) {
      throw new Error(`Session not found: ${opts.sessionId}`)
    }

    const sessionCwd = resolved.projectPath ?? opts.cwd ?? process.cwd()
    const { child, workDir } = await this.backend.spawnSession({
      cwd: sessionCwd,
      dangerouslySkipPermissions: opts.dangerouslySkipPermissions,
      resumeSessionId: opts.sessionId,
    })
    const session = await this.initializeSession(child, workDir, opts.sessionId)

    return { id: session.id, workDir: session.workDir, resumed: true }
  }

  async listSessions({
    cwd,
    limit,
    offset,
  }: {
    cwd?: string
    limit?: number
    offset?: number
  }): Promise<ListedSession[]> {
    // Retrieve persisted sessions from disk.
    const persisted = await listSessionsImpl({ dir: cwd, limit, offset })

    const result: ListedSession[] = []
    const handledIds = new Set<string>()

    for (const info of persisted) {
      handledIds.add(info.sessionId)
      const active = this.sessions.get(info.sessionId)
      if (active) {
        result.push({
          ...info,
          active: true,
          status: sessionStatus(active.clients.size),
          attachedClients: active.clients.size,
          lastActiveAt: active.lastActiveAt,
        })
      } else {
        result.push({
          ...info,
          active: false,
          status: 'persisted',
          attachedClients: 0,
        })
      }
    }

    return result
  }

  async getSessionRecords(
    sessionId: string,
    cwd?: string,
  ): Promise<unknown[] | null> {
    const resolved = await resolveSessionFilePath(sessionId, cwd)
    if (!resolved) return null
    const { messages } = await loadTranscriptFile(resolved.filePath)
    return Array.from(messages.values())
  }

  async ensureSession(sessionId: string): Promise<boolean> {
    return this.sessions.has(sessionId)
  }

  attachClient(
    sessionId: string,
    ws: Bun.ServerWebSocket<{ sessionId: string }>,
  ): boolean {
    const session = this.sessions.get(sessionId)
    if (!session) return false
    this.clearIdleTimer(session)
    session.clients.add(ws)
    this.markSessionActive(session)
    return true
  }

  ingestClientMessage(sessionId: string, payload: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    this.markSessionActive(session)

    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(payload) as Record<string, unknown>
    } catch {
      return
    }

    const type = parsed.type as string | undefined
    const fp = sessionFilePath(session)

    // ── Control messages ──────────────────────────────────────────────────
    // custom-title: write to disk, echo to all clients.
    if (type === 'custom-title') {
      const body = JSON.stringify({ type: 'custom-title', customTitle: parsed.customTitle })
      this.enqueueSessionWrite(session, fp, body + '\n', () => {
        this.broadcastToClients(session, body)
      }, `session ${sessionId} custom-title write error`)
      return
    }

    // tag: write to disk, echo to all clients.
    if (type === 'tag') {
      const body = JSON.stringify({ type: 'tag', tag: parsed.tag })
      this.enqueueSessionWrite(session, fp, body + '\n', () => {
        this.broadcastToClients(session, body)
      }, `session ${sessionId} tag write error`)
      return
    }

    // ── User messages ─────────────────────────────────────────────────────
    // Write the user message and a `lastPrompt` marker (for summary
    // extraction), then forward to the child process.
    if (type === 'user') {
      const text = extractUserText(parsed)
      const userLine = payload + '\n'
      const lastPromptLine = text
        ? JSON.stringify({ lastPrompt: text }) + '\n'
        : null

      session.pendingWrite = session.pendingWrite
        .then(() => appendFile(fp, userLine))
        .then(() =>
          lastPromptLine
            ? appendFile(fp, lastPromptLine)
            : undefined,
        )
        .then(() => {
          session.child.stdin.write(payload + '\n')
        })
        .catch(error => {
          this.logger?.error(
            `session ${sessionId} user message write error: ${String(error)}`,
          )
        })
      return
    }

    // ── Fallback: forward everything else to the child as-is ──────────────
    session.child.stdin.write(payload + '\n')
  }

  detachClient(
    sessionId: string,
    ws: Bun.ServerWebSocket<{ sessionId: string }>,
  ): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    session.clients.delete(ws)
    this.markSessionActive(session)
    this.scheduleIdleTimeout(session)
  }

  async destroyAll(): Promise<void> {
    const ids = [...this.sessions.keys()]
    for (const id of ids) {
      const session = this.sessions.get(id)
      if (!session) continue
      try {
        session.child.kill()
      } catch {
        // best-effort
      }
      this.clearIdleTimer(session)
      this.sessions.delete(id)
    }
  }

  /**
   * Returns the ID of the most recently active in-memory session, or undefined
   * if no sessions are running.  Used by the dashboard to route events to the
   * "current" session when no explicit session ID is provided.
   */
  getMostRecentSessionId(): string | undefined {
    let best: ActiveSession | undefined
    for (const session of this.sessions.values()) {
      if (!best || session.lastActiveAt > best.lastActiveAt) {
        best = session
      }
    }
    return best?.id
  }

  /** Whether the given session has an in-memory (running/detached) entry. */
  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId)
  }

  private async initializeSession(
    child: ServerSessionProcess,
    workDir: string,
    expectedSessionId?: string,
  ): Promise<ActiveSession> {
    const createdAt = Date.now()

    return await new Promise<ActiveSession>((resolve, reject) => {
      let session: ActiveSession | null = null
      let sessionReady = false
      let stdoutBuffer = ''
      let stderrBuffer = ''
      let settled = false

      const rejectBeforeReady = (message: string): void => {
        if (settled) return
        settled = true
        try {
          child.kill()
        } catch {
          // best-effort
        }
        reject(new Error(message))
      }

      const resolveReady = (readySession: ActiveSession): void => {
        if (settled) return
        settled = true
        resolve(readySession)
      }

      const consumeStdoutLine = (line: string): void => {
        const trimmed = line.trim()
        if (!trimmed) {
          return
        }

        if (!session) {
          const sessionId = extractSessionIdFromLine(trimmed)
          if (!sessionId) {
            this.logger?.warn(
              `dropping pre-init session output without session_id: ${trimmed}`,
            )
            return
          }
          if (expectedSessionId && sessionId !== expectedSessionId) {
            rejectBeforeReady(
              `Session resumed with unexpected ID (expected ${expectedSessionId}, got ${sessionId})`,
            )
            return
          }

          const readySession: ActiveSession = {
            id: sessionId,
            workDir,
            createdAt,
            lastActiveAt: createdAt,
            clients: new Set(),
            child,
            idleTimer: null,
            pendingWrite: Promise.resolve(),
          }
          session = readySession
          readySession.pendingWrite = this.writeInitialSessionState(
            readySession,
            trimmed,
          )
          readySession.pendingWrite
            .then(() => {
              sessionReady = true
              this.sessions.set(sessionId, readySession)
              this.scheduleIdleTimeout(readySession)
              resolveReady(readySession)
            })
            .catch(error => {
              this.clearIdleTimer(readySession)
              rejectBeforeReady(
                `Failed to initialize session ${sessionId}: ${String(error)}`,
              )
            })
          return
        }

        this.handleSessionOutputLine(session, trimmed)
      }

      child.stdout.on('data', chunk => {
        stdoutBuffer += chunk.toString('utf8')

        let newlineIndex = stdoutBuffer.indexOf('\n')
        while (newlineIndex !== -1) {
          const line = stdoutBuffer.slice(0, newlineIndex)
          stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1)
          consumeStdoutLine(line)
          newlineIndex = stdoutBuffer.indexOf('\n')
        }
      })

      child.stderr.on('data', chunk => {
        const text = chunk.toString('utf8')
        stderrBuffer += text

        if (!session) {
          return
        }

        const trimmed = text.trim()
        if (trimmed) {
          this.logger?.warn(`session ${session.id} stderr: ${trimmed}`)
        }
      })

      child.on('exit', code => {
        if (stdoutBuffer.trim()) {
          consumeStdoutLine(stdoutBuffer)
          stdoutBuffer = ''
        }

        if (!session || !sessionReady) {
          const stderrMessage = stderrBuffer.trim()
          rejectBeforeReady(
            stderrMessage
              ? `Session process exited before init (${code ?? 'null'}): ${stderrMessage}`
              : `Session process exited before init (${code ?? 'null'})`,
          )
          return
        }

        this.handleSessionExit(session, code)
      })
    })
  }

  private async writeInitialSessionState(
    session: ActiveSession,
    initLine: string,
  ): Promise<void> {
    const filePath = sessionFilePath(session)
    await mkdir(dirname(filePath), { recursive: true })
    await appendFile(
      filePath,
      JSON.stringify({
        type: 'system',
        subtype: 'session_start',
        session_id: session.id,
        cwd: session.workDir,
        timestamp: new Date(session.createdAt).toISOString(),
        summary: session.id,
      }) + '\n',
    )
    await appendFile(filePath, initLine + '\n')
  }

  private handleSessionOutputLine(session: ActiveSession, line: string): void {
    const parsed = parseStructuredLine(line)
    if (!parsed) {
      this.logger?.warn(`dropping non-JSON stdout for session ${session.id}`)
      return
    }

    this.markSessionActive(session)
    this.enqueueSessionWrite(
      session,
      sessionFilePath(session),
      line + '\n',
      () => {
        this.broadcastToClients(session, line)
      },
      `session ${session.id} stdout write error`,
    )
  }

  private handleSessionExit(
    session: ActiveSession,
    code: number | null,
  ): void {
    this.clearIdleTimer(session)
    this.sessions.delete(session.id)

    const reason = code === null ? 'terminated' : `exited with code ${code}`
    this.logger?.info(`session ${session.id} ${reason}`)

    for (const client of session.clients) {
      try {
        client.close(1000, 'session exited')
      } catch {
        // best-effort
      }
    }
    session.clients.clear()
  }

  private enqueueSessionWrite(
    session: ActiveSession,
    filePath: string,
    line: string,
    onSuccess: () => void,
    errorPrefix: string,
  ): void {
    session.pendingWrite = session.pendingWrite
      .then(() => appendFile(filePath, line))
      .then(() => {
        onSuccess()
      })
      .catch(error => {
        this.logger?.error(`${errorPrefix}: ${String(error)}`)
      })
  }

  private broadcastToClients(session: ActiveSession, body: string): void {
    for (const client of session.clients) {
      try {
        client.send(body)
      } catch (error) {
        this.logger?.warn(
          `failed to send session ${session.id} update to a client: ${String(error)}`,
        )
      }
    }
    // Notify all SSE line subscribers (e.g. dashboard API handler).
    for (const subscriber of this.lineSubscribers) {
      try {
        subscriber(session.id, body)
      } catch {
        // best-effort — subscriber errors must not break session broadcast
      }
    }
  }

  private markSessionActive(session: ActiveSession): void {
    session.lastActiveAt = Date.now()
  }

  private clearIdleTimer(session: ActiveSession): void {
    if (!session.idleTimer) {
      return
    }
    clearTimeout(session.idleTimer)
    session.idleTimer = null
  }

  private scheduleIdleTimeout(session: ActiveSession): void {
    this.clearIdleTimer(session)

    const idleTimeoutMs = this.options.idleTimeoutMs ?? 0
    if (idleTimeoutMs <= 0 || session.clients.size > 0) {
      return
    }

    session.idleTimer = setTimeout(() => {
      this.logger?.info(
        `session ${session.id} idle timeout reached after ${idleTimeoutMs}ms`,
      )
      try {
        session.child.kill()
      } catch (error) {
        this.logger?.warn(
          `failed to stop idle session ${session.id}: ${String(error)}`,
        )
      }
    }, idleTimeoutMs)
    session.idleTimer.unref?.()
  }
}
