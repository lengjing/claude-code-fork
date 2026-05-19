/**
 * Dashboard API handler — implements all /api/* endpoints consumed by the
 * Claude Code dashboard SPA.
 *
 * Architecture:
 *   - REST endpoints return JSON for GET/POST requests
 *   - GET /api/events returns an SSE stream that relays session output,
 *     translating the internal stream-json format into "dash events" that
 *     the dashboard's chat panel understands
 *   - All mutating actions (submit, abort, etc.) route to the "current"
 *     session — the most recently active in-memory session, auto-created
 *     on first submit if none exists
 */

import { readdir, readFile, stat, writeFile, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import { join, dirname, resolve, sep } from 'path'
import { fileURLToPath } from 'url'
import { randomUUID } from 'crypto'
import { getClaudeConfigHomeDir } from '../utils/envUtils.js'
import { getProjectsDir } from '../utils/sessionStoragePortable.js'
import type { SessionManager } from './sessionManager.js'
import type { ServerConfig } from './types.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Format a byte count as a human-readable string (B / KB / MB). */
function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1048576).toFixed(1)} MB`
}

type DashEvent =
  | { kind: 'ping' }
  | { kind: 'busy-change'; busy: boolean }
  | { kind: 'user'; id: string; text: string }
  | { kind: 'assistant_delta'; id: string; contentDelta: string; reasoningDelta: string }
  | { kind: 'assistant_final'; id: string; text: string }
  | { kind: 'tool_start'; id: string; toolName: string; args: string }
  | { kind: 'tool'; id: string }
  | { kind: 'warning' | 'error' | 'info'; id: string; text: string }
  | { kind: 'status'; text: string }
  | { kind: 'modal-up'; modal: Record<string, unknown> }
  | { kind: 'modal-down'; modalKind: string }

interface SseClient {
  sessionId: string | null
  enqueue: (event: DashEvent) => void
  close: () => void
}

// ---------------------------------------------------------------------------
// Stream-JSON → dash event translation
// ---------------------------------------------------------------------------

/**
 * Translates a single stream-json line (as parsed JSON) into zero or more
 * dash events for the dashboard SSE stream.
 */
function streamJsonToDashEvents(line: Record<string, unknown>): DashEvent[] {
  const type = line.type as string | undefined
  const uuid = (line.uuid as string | undefined) ?? `msg-${Date.now()}`

  if (type === 'user') {
    const msg = line.message as Record<string, unknown> | undefined
    let text = ''
    if (typeof msg?.content === 'string') {
      text = msg.content
    } else if (Array.isArray(msg?.content)) {
      for (const block of msg!.content as Record<string, unknown>[]) {
        if (block.type === 'text' && typeof block.text === 'string') {
          text += block.text
        }
      }
    } else if (typeof line.text === 'string') {
      // Simplified internal format
      text = line.text
    }
    return [{ kind: 'user', id: uuid, text }]
  }

  if (type === 'assistant') {
    const msg = line.message as Record<string, unknown> | undefined
    const content = Array.isArray(msg?.content)
      ? (msg!.content as Record<string, unknown>[])
      : []

    const events: DashEvent[] = []
    let finalText = ''
    let hasPartial = false

    for (const block of content) {
      if (block.type === 'text') {
        if (block.partial) {
          hasPartial = true
          events.push({
            kind: 'assistant_delta',
            id: uuid,
            contentDelta: typeof block.text === 'string' ? block.text : '',
            reasoningDelta: '',
          })
        } else {
          finalText += typeof block.text === 'string' ? block.text : ''
        }
      } else if (block.type === 'thinking') {
        if (block.partial) {
          hasPartial = true
          events.push({
            kind: 'assistant_delta',
            id: uuid,
            contentDelta: '',
            reasoningDelta: typeof block.thinking === 'string' ? block.thinking : '',
          })
        }
      } else if (block.type === 'tool_use' && !block.partial) {
        const toolId = (block.id as string | undefined) ?? `tool-${Date.now()}`
        events.push({
          kind: 'tool_start',
          id: toolId,
          toolName: typeof block.name === 'string' ? block.name : 'unknown',
          args: JSON.stringify(block.input ?? {}),
        })
      }
    }

    if (!hasPartial && finalText) {
      events.push({ kind: 'assistant_final', id: uuid, text: finalText })
    }

    return events
  }

  if (type === 'tool_result') {
    const toolUseId = (line.tool_use_id as string | undefined) ?? uuid
    return [{ kind: 'tool', id: toolUseId }]
  }

  if (type === 'result') {
    // Session turn finished — session is now idle
    return [{ kind: 'busy-change', busy: false }]
  }

  if (type === 'system') {
    const subtype = line.subtype as string | undefined
    if (subtype === 'api_retry') {
      const attempt = line.attempt as number | undefined
      const maxRetries = line.max_retries as number | undefined
      return [
        {
          kind: 'info',
          id: randomUUID(),
          text: `API retry ${attempt ?? '?'}/${maxRetries ?? '?'}`,
        },
      ]
    }
  }

  if (type === 'control_request') {
    const req = line.request as Record<string, unknown> | undefined
    if (req?.subtype === 'can_use_tool') {
      return [
        {
          kind: 'modal-up',
          modal: {
            kind: 'shell',
            requestId: line.request_id,
            toolName: req.tool_name,
            input: req.tool_input,
          },
        },
      ]
    }
  }

  return []
}

// ---------------------------------------------------------------------------
// SSE client registry
// ---------------------------------------------------------------------------

const sseClients = new Set<SseClient>()

function broadcastDashEvent(sessionId: string, event: DashEvent): void {
  for (const client of sseClients) {
    if (client.sessionId === null || client.sessionId === sessionId) {
      try {
        client.enqueue(event)
      } catch {
        // Client closed or errored — remove it
        sseClients.delete(client)
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Public initialisation — wire the session manager line subscriber
// ---------------------------------------------------------------------------

export function initDashboardSubscriber(sessionManager: SessionManager): () => void {
  return sessionManager.subscribeLines((sessionId, line) => {
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(line) as Record<string, unknown>
    } catch {
      return
    }
    const events = streamJsonToDashEvents(parsed)
    for (const event of events) {
      broadcastDashEvent(sessionId, event)
    }
    // Infer busy=true whenever a user message arrives or model starts generating.
    const type = parsed.type as string | undefined
    if (type === 'user') {
      broadcastDashEvent(sessionId, { kind: 'busy-change', busy: true })
    }
  })
}

// ---------------------------------------------------------------------------
// Auth helper
// ---------------------------------------------------------------------------

function checkAuth(req: Request, authToken: string | undefined): boolean {
  if (!authToken) return true
  const header = req.headers.get('X-Claude-Code-Token')
  if (header === authToken) return true
  const url = new URL(req.url)
  return url.searchParams.get('token') === authToken
}

function unauthorized(): Response {
  return new Response(JSON.stringify({ error: 'Unauthorized' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  })
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

// ---------------------------------------------------------------------------
// Dashboard static file serving
// ---------------------------------------------------------------------------

/**
 * Resolves the path to the dashboard dist directory.  Checks several
 * candidates so it works both when running from source and from the
 * compiled binary.
 */
function getDashboardDistDir(): string | null {
  const candidates = [
    // Adjacent to this source file (development)
    join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'dashboard', 'dist'),
    // Adjacent to process entry point
    join(process.cwd(), 'dashboard', 'dist'),
  ]
  for (const candidate of candidates) {
    if (existsSync(join(candidate, 'assets', 'app.js'))) return candidate
  }
  return null
}

export async function serveDashboardAsset(pathname: string): Promise<Response | null> {
  const distDir = getDashboardDistDir()
  if (!distDir) return null

  // Strip leading /assets/
  const relative = pathname.replace(/^\/assets\//, '')
  if (!relative || relative.includes('..')) return null

  const filePath = join(distDir, 'assets', relative)
  if (!existsSync(filePath)) return null

  const fileContent = await Bun.file(filePath).arrayBuffer()
  const ext = filePath.split('.').pop() ?? ''
  const contentType =
    ext === 'js'
      ? 'application/javascript; charset=utf-8'
      : ext === 'css'
        ? 'text/css; charset=utf-8'
        : 'application/octet-stream'

  return new Response(fileContent, {
    headers: { 'Content-Type': contentType },
  })
}

export async function serveDashboardHtml(authToken: string | undefined): Promise<Response> {
  const distDir = getDashboardDistDir()
  if (!distDir) {
    return new Response(
      `<!doctype html><html><body>
        <h2>Dashboard not built</h2>
        <p>Run <code>cd dashboard && bun install && bun run build.ts</code> to build the dashboard.</p>
      </body></html>`,
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    )
  }

  const indexPath = join(distDir, '..', 'index.html')
  if (!existsSync(indexPath)) {
    return new Response('Dashboard index.html not found', {
      status: 503,
      headers: { 'Content-Type': 'text/plain' },
    })
  }

  const token = authToken ?? ''
  let html = await readFile(indexPath, 'utf-8')
  html = html
    .replaceAll('__CLAUDE_CODE_TOKEN__', token)
    .replaceAll('__CLAUDE_CODE_MODE__', 'standalone')

  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}

// ---------------------------------------------------------------------------
// API route handler
// ---------------------------------------------------------------------------

export async function handleDashboardApi(
  req: Request,
  pathname: string,
  sessionManager: SessionManager,
  config: ServerConfig,
  getWorkspaceDir: () => string,
): Promise<Response | null> {
  // Strip /api prefix
  const apiPath = pathname.replace(/^\/api/, '') || '/'

  // Auth check — all /api/* routes require the token
  if (!checkAuth(req, config.authToken)) return unauthorized()

  // ── GET /api/overview ───────────────────────────────────────────────────
  if (req.method === 'GET' && apiPath === '/overview') {
    const sessionId = sessionManager.getMostRecentSessionId() ?? null
    return json({
      mode: 'standalone',
      version: '2.1.88',
      session: sessionId,
      cwd: getWorkspaceDir(),
      editMode: 'auto',
      toolCount: null,
      mcpServerCount: 0,
      cockpit: {
        balance: null,
        tokens7d: null,
        cacheHit7d: null,
        costTrend14d: null,
        currentSession: null,
        toolCalls24h: null,
        recentPlans: null,
        toolActivity: null,
      },
      budgetUsd: null,
      sessionSpendUsd: null,
    })
  }

  // ── GET /api/health ──────────────────────────────────────────────────────
  if (req.method === 'GET' && apiPath === '/health') {
    const projectsDir = getProjectsDir()
    const claudeHome = getClaudeConfigHomeDir()
    let sessionCount = 0
    let sessionBytes = 0
    try {
      const entries = await readdir(projectsDir, { recursive: true })
      for (const e of entries) {
        if (typeof e === 'string' && e.endsWith('.jsonl')) {
          sessionCount++
          try {
            const s = await stat(join(projectsDir, e))
            sessionBytes += s.size
          } catch {
            // best-effort
          }
        }
      }
    } catch {
      // projects dir may not exist yet
    }

    let memoryFileCount = 0
    let memoryBytes = 0
    const memDir = join(claudeHome, 'memory')
    try {
      const memFiles = await readdir(memDir)
      for (const f of memFiles) {
        if (f.endsWith('.md')) {
          memoryFileCount++
          try {
            const s = await stat(join(memDir, f))
            memoryBytes += s.size
          } catch {
            // best-effort
          }
        }
      }
    } catch {
      // memory dir may not exist
    }

    const usageLogPath = join(claudeHome, 'usage.jsonl')
    let usageBytes = 0
    try {
      usageBytes = (await stat(usageLogPath)).size
    } catch {
      // file may not exist
    }

    return json({
      version: '2.1.88',
      latestVersion: null,
      sessions: {
        count: sessionCount,
        totalBytes: sessionBytes,
        path: projectsDir,
      },
      memory: {
        fileCount: memoryFileCount,
        totalBytes: memoryBytes,
        path: memDir,
      },
      semantic: {
        exists: false,
        path: join(claudeHome, 'semantic'),
      },
      usageLog: {
        bytes: usageBytes,
        path: usageLogPath,
      },
      jobs: null,
      claudeCodeHome: claudeHome,
    })
  }

  // ── GET /api/sessions ────────────────────────────────────────────────────
  if (req.method === 'GET' && apiPath === '/sessions') {
    const listed = await sessionManager.listSessions({ cwd: getWorkspaceDir() })
    const sessions = listed.map(s => ({
      name: s.sessionId,
      messageCount: 0, // cheaply omit for now
      size: s.fileSize ?? 0,
      mtime: s.lastModified ?? s.createdAt ?? Date.now(),
      summary: s.customTitle ?? s.firstPrompt ?? s.sessionId,
      status: s.status,
    }))
    return json({ sessions })
  }

  // ── GET /api/sessions/:id ────────────────────────────────────────────────
  const sessionDetailMatch = apiPath.match(/^\/sessions\/([^/]+)$/)
  if (req.method === 'GET' && sessionDetailMatch) {
    const id = decodeURIComponent(sessionDetailMatch[1]!)
    const records = await sessionManager.getSessionRecords(id)
    if (!records) {
      return json({ error: 'Session not found' }, 404)
    }
    return json({ messages: records })
  }

  // ── GET /api/messages ────────────────────────────────────────────────────
  if (req.method === 'GET' && apiPath === '/messages') {
    const url = new URL(req.url)
    const sessionId =
      url.searchParams.get('session_id') ?? sessionManager.getMostRecentSessionId() ?? null
    const messages: unknown[] = []
    if (sessionId) {
      const records = await sessionManager.getSessionRecords(sessionId)
      if (records) {
        for (const record of records) {
          const r = record as Record<string, unknown>
          const type = r.type as string | undefined
          if (type === 'user') {
            const msg = r.message as Record<string, unknown> | undefined
            let text = ''
            if (typeof msg?.content === 'string') text = msg.content
            else if (Array.isArray(msg?.content)) {
              for (const b of msg!.content as Record<string, unknown>[]) {
                if (b.type === 'text') text += String(b.text ?? '')
              }
            } else if (typeof r.text === 'string') text = r.text
            messages.push({ id: String(r.uuid ?? randomUUID()), role: 'user', text })
          } else if (type === 'assistant') {
            const msg = r.message as Record<string, unknown> | undefined
            const content = Array.isArray(msg?.content)
              ? (msg!.content as Record<string, unknown>[])
              : []
            let text = ''
            for (const block of content) {
              if (block.type === 'text' && !block.partial) {
                text += String(block.text ?? '')
              }
            }
            if (text) {
              messages.push({ id: String(r.uuid ?? randomUUID()), role: 'assistant', text })
            }
          }
        }
      }
    }
    return json({ messages, busy: false, sessionId })
  }

  // ── GET /api/modal ───────────────────────────────────────────────────────
  if (req.method === 'GET' && apiPath === '/modal') {
    return json({ modal: null })
  }

  // ── GET /api/slash ───────────────────────────────────────────────────────
  if (req.method === 'GET' && apiPath === '/slash') {
    return json({
      commands: [
        { cmd: '/help', summary: 'Show help' },
        { cmd: '/new', summary: 'Start a new session' },
        { cmd: '/clear', summary: 'Clear the current context' },
        { cmd: '/compact', summary: 'Compact older context' },
        { cmd: '/retry', summary: 'Retry the last message' },
        { cmd: '/stop', summary: 'Stop the current response' },
        { cmd: '/model', summary: 'Change the model' },
        { cmd: '/status', summary: 'Show session status' },
        { cmd: '/cost', summary: 'Show usage cost' },
      ],
    })
  }

  // ── GET /api/tools ───────────────────────────────────────────────────────
  if (req.method === 'GET' && apiPath === '/tools') {
    return json({ total: 0, tools: [] })
  }

  // ── GET /api/usage ───────────────────────────────────────────────────────
  if (req.method === 'GET' && apiPath === '/usage') {
    const claudeHome = getClaudeConfigHomeDir()
    const projectsDir = getProjectsDir()
    type UsageRecord = {
      costUSD?: number
      inputTokens?: number
      cacheReadInputTokens?: number
      outputTokens?: number
      model?: string
      startTime?: string
      // session-jsonl result message fields
      cost_usd?: number
      input_tokens?: number
      cache_read_input_tokens?: number
      output_tokens?: number
      timestamp?: string
      type?: string
      subtype?: string
    }
    const records: UsageRecord[] = []
    // Try reading a central usage.jsonl first
    const usageLogPath = join(claudeHome, 'usage.jsonl')
    let logSize = '0 B'
    try {
      const raw = await readFile(usageLogPath, 'utf8')
      const lines = raw.split('\n').filter(Boolean)
      for (const line of lines) {
        try {
          records.push(JSON.parse(line) as UsageRecord)
        } catch { /* skip malformed lines */ }
      }
      const bytes = Buffer.byteLength(raw)
      logSize = fmtBytes(bytes)
    } catch {
      // usage.jsonl not present — read result lines from session jsonl files
      try {
        const entries = await readdir(projectsDir, { recursive: true })
        for (const e of entries) {
          if (typeof e !== 'string' || !e.endsWith('.jsonl')) continue
          try {
            const raw = await readFile(join(projectsDir, e), 'utf8')
            for (const line of raw.split('\n')) {
              if (!line.trim()) continue
              try {
                const parsed = JSON.parse(line) as UsageRecord
                if (parsed.type === 'result' && parsed.subtype === 'success') {
                  records.push(parsed)
                }
              } catch { /* skip */ }
            }
          } catch { /* skip unreadable files */ }
        }
      } catch { /* projects dir may not exist */ }
      // ~80 bytes per result line is a conservative estimate for a minimal
      // result JSON object (type, subtype, session_id, cost_usd, timestamps)
      const totalBytes = records.length * 80
      logSize = records.length === 0 ? '0 B' : `~${fmtBytes(totalBytes)}`
    }

    // Aggregate into time buckets
    const now = Date.now()
    const MS = { h24: 86400000, d7: 604800000, d30: 2592000000 }
    type Bucket = { label: string; cutoff: number; turns: number; cacheHitTokens: number; cacheMissTokens: number; costUsd: number; cacheSavingsUsd: number; claudeEquivUsd: number }
    const buckets: Bucket[] = [
      { label: 'Last 24 h', cutoff: now - MS.h24, turns: 0, cacheHitTokens: 0, cacheMissTokens: 0, costUsd: 0, cacheSavingsUsd: 0, claudeEquivUsd: 0 },
      { label: 'Last 7 d',  cutoff: now - MS.d7,  turns: 0, cacheHitTokens: 0, cacheMissTokens: 0, costUsd: 0, cacheSavingsUsd: 0, claudeEquivUsd: 0 },
      { label: 'Last 30 d', cutoff: now - MS.d30, turns: 0, cacheHitTokens: 0, cacheMissTokens: 0, costUsd: 0, cacheSavingsUsd: 0, claudeEquivUsd: 0 },
      { label: 'All time',  cutoff: 0,            turns: 0, cacheHitTokens: 0, cacheMissTokens: 0, costUsd: 0, cacheSavingsUsd: 0, claudeEquivUsd: 0 },
    ]
    const byModel = new Map<string, number>()
    for (const r of records) {
      const cost = r.costUSD ?? r.cost_usd ?? 0
      const input = r.inputTokens ?? r.input_tokens ?? 0
      const cacheRead = r.cacheReadInputTokens ?? r.cache_read_input_tokens ?? 0
      const ts = r.startTime ?? r.timestamp
      const when = ts ? Date.parse(ts) : 0
      const model = r.model ?? 'unknown'
      byModel.set(model, (byModel.get(model) ?? 0) + 1)
      for (const b of buckets) {
        if (when >= b.cutoff) {
          b.turns++
          b.cacheHitTokens += cacheRead
          b.cacheMissTokens += input - cacheRead
          b.costUsd += cost
        }
      }
    }
    return json({
      recordCount: records.length,
      logSize,
      buckets: buckets.map(b => ({
        label: b.label,
        turns: b.turns,
        cacheHitTokens: b.cacheHitTokens,
        cacheMissTokens: b.cacheMissTokens,
        costUsd: b.costUsd,
        cacheSavingsUsd: b.cacheSavingsUsd,
        claudeEquivUsd: b.claudeEquivUsd,
      })),
      byModel: [...byModel.entries()].sort((a, b) => b[1] - a[1]).map(([model, turns]) => ({ model, turns })),
    })
  }

  // ── GET /api/usage/series ────────────────────────────────────────────────
  if (req.method === 'GET' && apiPath === '/usage/series') {
    return json({ days: [] })
  }

  // ── GET /api/permissions ─────────────────────────────────────────────────
  if (req.method === 'GET' && apiPath === '/permissions') {
    return json({
      editMode: 'auto',
      currentCwd: getWorkspaceDir(),
      project: [] as string[],
      builtin: [
        'Read file', 'Write file', 'Execute bash', 'List directory',
        'Search files', 'Edit file', 'Create file', 'Delete file',
      ],
    })
  }

  // ── POST /api/permissions ─────────────────────────────────────────────────
  if (req.method === 'POST' && apiPath === '/permissions') {
    return json({ ok: true, alreadyPresent: false })
  }

  // ── DELETE /api/permissions ──────────────────────────────────────────────
  if (req.method === 'DELETE' && apiPath === '/permissions') {
    return json({ ok: true })
  }

  // ── POST /api/permissions/clear ───────────────────────────────────────────
  if (req.method === 'POST' && apiPath === '/permissions/clear') {
    return json({ ok: true, dropped: 0 })
  }

  // ── GET /api/memory ──────────────────────────────────────────────────────
  if (req.method === 'GET' && apiPath === '/memory') {
    const claudeHome = getClaudeConfigHomeDir()
    const memDir = join(claudeHome, 'memory')
    const cwd = getWorkspaceDir()

    // Global memory files (~/.claude/memory/*.md)
    const globalFiles: { name: string; size: number; mtime: number }[] = []
    try {
      const entries = await readdir(memDir)
      for (const f of entries) {
        if (!f.endsWith('.md')) continue
        try {
          const s = await stat(join(memDir, f))
          globalFiles.push({ name: f, size: s.size, mtime: s.mtimeMs })
        } catch { /* skip */ }
      }
    } catch { /* dir may not exist */ }

    // Project CLAUDE.md
    const projectClaudeMd = join(cwd, 'CLAUDE.md')
    const projectExists = existsSync(projectClaudeMd)

    return json({
      project: { path: projectClaudeMd, exists: projectExists },
      global: { files: globalFiles },
      projectMem: { path: null, files: [] },
    })
  }

  // ── GET /api/memory/project ───────────────────────────────────────────────
  if (req.method === 'GET' && apiPath === '/memory/project') {
    const cwd = getWorkspaceDir()
    const filePath = join(cwd, 'CLAUDE.md')
    let body = ''
    try { body = await readFile(filePath, 'utf8') } catch { /* file may not exist */ }
    return json({ body })
  }

  // ── POST /api/memory/project ──────────────────────────────────────────────
  if (req.method === 'POST' && apiPath === '/memory/project') {
    const cwd = getWorkspaceDir()
    const filePath = join(cwd, 'CLAUDE.md')
    let body = ''
    try { body = ((await req.json()) as { body?: string }).body ?? '' } catch { /* ignore */ }
    try { await writeFile(filePath, body, 'utf8') } catch (err) {
      return json({ error: String(err) }, 500)
    }
    return json({ ok: true })
  }

  // ── GET /api/memory/global/:name ──────────────────────────────────────────
  const memGlobalReadMatch = apiPath.match(/^\/memory\/global\/(.+)$/)
  if (req.method === 'GET' && memGlobalReadMatch) {
    const name = decodeURIComponent(memGlobalReadMatch[1]!)
    const claudeHome = getClaudeConfigHomeDir()
    const memDir = resolve(join(claudeHome, 'memory'))
    const filePath = resolve(join(memDir, name))
    // Ensure the resolved path is strictly inside the memory directory
    if (!filePath.startsWith(memDir + sep)) {
      return json({ error: 'Invalid file name' }, 400)
    }
    let body = ''
    try { body = await readFile(filePath, 'utf8') } catch { /* file may not exist */ }
    return json({ body })
  }

  // ── POST /api/memory/global/:name ─────────────────────────────────────────
  const memGlobalWriteMatch = apiPath.match(/^\/memory\/global\/(.+)$/)
  if (req.method === 'POST' && memGlobalWriteMatch) {
    const name = decodeURIComponent(memGlobalWriteMatch[1]!)
    const claudeHome = getClaudeConfigHomeDir()
    const memDir = resolve(join(claudeHome, 'memory'))
    const filePath = resolve(join(memDir, name))
    // Ensure the resolved path is strictly inside the memory directory
    if (!filePath.startsWith(memDir + sep)) {
      return json({ error: 'Invalid file name' }, 400)
    }
    let body = ''
    try { body = ((await req.json()) as { body?: string }).body ?? '' } catch { /* ignore */ }
    try {
      await mkdir(memDir, { recursive: true })
      await writeFile(filePath, body, 'utf8')
    } catch (err) {
      return json({ error: String(err) }, 500)
    }
    return json({ ok: true })
  }

  // ── GET/POST /api/memory/project-mem/* ───────────────────────────────────
  if (apiPath.startsWith('/memory/project-mem')) {
    return json({ body: '', ok: true })
  }

  // ── GET /api/settings ────────────────────────────────────────────────────
  if (req.method === 'GET' && apiPath === '/settings') {
    return json({
      model: null,
      preset: null,
      editMode: 'auto',
      budgetUsd: null,
      sessionSpendUsd: null,
      skillPaths: [],
      search: false,
      proNext: false,
    })
  }

  // ── POST /api/settings ───────────────────────────────────────────────────
  if (req.method === 'POST' && apiPath === '/settings') {
    return json({ ok: true })
  }

  // ── GET /api/plans ───────────────────────────────────────────────────────
  if (req.method === 'GET' && apiPath === '/plans') {
    return json({ plans: [] })
  }

  // ── GET /api/hooks ───────────────────────────────────────────────────────
  if (req.method === 'GET' && apiPath === '/hooks') {
    const claudeHome = getClaudeConfigHomeDir()
    const cwd = getWorkspaceDir()
    const HOOK_EVENTS = ['PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'Stop']

    // Try reading global settings.json for hooks
    let globalHooks: Record<string, unknown> = {}
    const globalSettingsPath = join(claudeHome, 'settings.json')
    try {
      const raw = await readFile(globalSettingsPath, 'utf8')
      const parsed = JSON.parse(raw) as { hooks?: Record<string, unknown> }
      globalHooks = parsed.hooks ?? {}
    } catch { /* settings may not exist */ }

    // Try reading project settings.json for hooks
    let projectHooks: Record<string, unknown> = {}
    const projectSettingsPath = join(cwd, '.claude', 'settings.json')
    let projectSettingsExists = false
    try {
      const raw = await readFile(projectSettingsPath, 'utf8')
      const parsed = JSON.parse(raw) as { hooks?: Record<string, unknown> }
      projectHooks = parsed.hooks ?? {}
      projectSettingsExists = true
    } catch { /* may not exist */ }

    return json({
      resolved: [],
      events: HOOK_EVENTS,
      project: {
        path: projectSettingsExists ? projectSettingsPath : null,
        hooks: projectHooks,
      },
      global: {
        path: globalSettingsPath,
        hooks: globalHooks,
      },
      recentRuns: [],
    })
  }

  // ── POST /api/hooks/save ──────────────────────────────────────────────────
  if (req.method === 'POST' && apiPath === '/hooks/save') {
    let body: { scope?: string; hooks?: unknown } = {}
    try { body = (await req.json()) as typeof body } catch { /* ignore */ }
    const scope = body.scope === 'global' ? 'global' : 'project'
    const claudeHome = getClaudeConfigHomeDir()
    const cwd = getWorkspaceDir()
    const settingsPath = scope === 'global'
      ? join(claudeHome, 'settings.json')
      : join(cwd, '.claude', 'settings.json')
    try {
      let existing: Record<string, unknown> = {}
      try {
        existing = JSON.parse(await readFile(settingsPath, 'utf8')) as Record<string, unknown>
      } catch { /* file may not exist yet */ }
      existing.hooks = body.hooks ?? {}
      await mkdir(dirname(settingsPath), { recursive: true })
      await writeFile(settingsPath, JSON.stringify(existing, null, 2), 'utf8')
    } catch (err) {
      return json({ error: String(err) }, 500)
    }
    return json({ ok: true })
  }

  // ── POST /api/hooks/reload ────────────────────────────────────────────────
  if (req.method === 'POST' && apiPath === '/hooks/reload') {
    return json({ ok: true })
  }

  // ── GET /api/mcp ─────────────────────────────────────────────────────────
  if (req.method === 'GET' && apiPath === '/mcp') {
    return json({ servers: [] })
  }

  // ── DELETE /api/mcp/specs ────────────────────────────────────────────────
  if (req.method === 'DELETE' && apiPath === '/mcp/specs') {
    return json({ ok: true })
  }

  // ── GET /api/skills/* ────────────────────────────────────────────────────
  if (req.method === 'GET' && apiPath.startsWith('/skills')) {
    return json({ skills: [] })
  }

  // ── POST/DELETE /api/skills/* ────────────────────────────────────────────
  if ((req.method === 'POST' || req.method === 'DELETE') && apiPath.startsWith('/skills')) {
    return json({ ok: true })
  }

  // ── GET /api/semantic ────────────────────────────────────────────────────
  if (req.method === 'GET' && apiPath === '/semantic') {
    return json({
      attached: false,
      reason: 'Semantic search is not available in this version of Claude Code.',
      index: { exists: false },
      job: null,
      pull: null,
    })
  }

  // ── GET /api/semantic/config ──────────────────────────────────────────────
  if (req.method === 'GET' && apiPath === '/semantic/config') {
    // Ollama's standard binding is HTTP on localhost — it does not support
    // HTTPS natively and is always accessed over a loopback interface.
    return json({
      provider: 'ollama',
      ollama: { baseUrl: 'http://localhost:11434', model: 'nomic-embed-text' },
      openaiCompat: {
        baseUrl: '',
        apiKey: '',
        apiKeySet: false,
        model: '',
        extraBody: {},
      },
    })
  }

  // ── POST /api/semantic/* ─────────────────────────────────────────────────
  if (req.method === 'POST' && apiPath.startsWith('/semantic')) {
    return json({ ok: true, error: 'Semantic search is not available in this version.' })
  }

  // ── POST /api/loop/start ──────────────────────────────────────────────────
  if (req.method === 'POST' && apiPath === '/loop/start') {
    return json({ ok: true })
  }

  // ── POST /api/loop/stop ───────────────────────────────────────────────────
  if (req.method === 'POST' && apiPath === '/loop/stop') {
    return json({ ok: true })
  }

  // ── POST /api/checkpoint-create ───────────────────────────────────────────
  if (req.method === 'POST' && apiPath === '/checkpoint-create') {
    return json({ ok: true })
  }

  // ── POST /api/checkpoint-restore ──────────────────────────────────────────
  if (req.method === 'POST' && apiPath === '/checkpoint-restore') {
    return json({ ok: true })
  }

  // ── POST /api/checkpoint-delete ───────────────────────────────────────────
  if (req.method === 'POST' && apiPath === '/checkpoint-delete') {
    return json({ ok: true })
  }

  // ── POST /api/edit-mode ───────────────────────────────────────────────────
  if (req.method === 'POST' && apiPath === '/edit-mode') {
    return json({ ok: true })
  }

  // ── POST /api/lang ────────────────────────────────────────────────────────
  if (req.method === 'POST' && apiPath === '/lang') {
    return json({ ok: true })
  }

  // ── POST /api/modal/resolve ───────────────────────────────────────────────
  if (req.method === 'POST' && apiPath === '/modal/resolve') {
    const url = new URL(req.url)
    const sessionId =
      url.searchParams.get('session_id') ?? sessionManager.getMostRecentSessionId()
    if (!sessionId) return json({ error: 'No active session' }, 503)

    let body: { requestId?: string; behavior?: string } = {}
    try {
      body = (await req.json()) as typeof body
    } catch {
      // use empty defaults
    }
    if (body.requestId && body.behavior) {
      sessionManager.ingestClientMessage(
        sessionId,
        JSON.stringify({
          type: 'control_response',
          response: {
            subtype: 'success',
            request_id: body.requestId,
            response: { behavior: body.behavior },
          },
        }),
      )
    }
    return json({ ok: true })
  }

  // ── POST /api/abort ───────────────────────────────────────────────────────
  if (req.method === 'POST' && apiPath === '/abort') {
    const url = new URL(req.url)
    const sessionId =
      url.searchParams.get('session_id') ?? sessionManager.getMostRecentSessionId()
    if (!sessionId) return json({ error: 'No active session' }, 503)

    // Send an interrupt control request to the session
    sessionManager.ingestClientMessage(
      sessionId,
      JSON.stringify({ type: 'control_request', request: { subtype: 'interrupt' } }),
    )
    return json({ ok: true })
  }

  // ── POST /api/submit ──────────────────────────────────────────────────────
  if (req.method === 'POST' && apiPath === '/submit') {
    let body: { prompt?: string; session_id?: string } = {}
    try {
      body = (await req.json()) as typeof body
    } catch {
      return json({ error: 'Invalid JSON body' }, 400)
    }

    const prompt = body.prompt ?? ''
    if (!prompt.trim()) return json({ accepted: false, reason: 'Empty prompt' })

    const url = new URL(req.url)
    let sessionId =
      body.session_id ??
      url.searchParams.get('session_id') ??
      sessionManager.getMostRecentSessionId()

    // Auto-create a session if none exists
    if (!sessionId) {
      try {
        const created = await sessionManager.createSession({ cwd: getWorkspaceDir() })
        sessionId = created.id
      } catch (err) {
        return json(
          { accepted: false, reason: `Failed to create session: ${String(err)}` },
          503,
        )
      }
    }

    sessionManager.ingestClientMessage(
      sessionId,
      JSON.stringify({
        type: 'user',
        text: prompt,
        message: { role: 'user', content: prompt },
        parent_tool_use_id: null,
        session_id: sessionId,
      }),
    )
    return json({ accepted: true, sessionId })
  }

  // ── GET /api/models ───────────────────────────────────────────────────────
  if (req.method === 'GET' && apiPath === '/models') {
    return json({
      models: [
        'claude-opus-4-5',
        'claude-sonnet-4-5',
        'claude-haiku-4-5',
        'claude-opus-4-6',
        'claude-sonnet-4-6',
        'claude-3-5-sonnet-20241022',
        'claude-3-5-haiku-20241022',
      ],
      current: null,
      pricing: {},
    })
  }

  // ── GET /api/loop/status ──────────────────────────────────────────────────
  if (req.method === 'GET' && apiPath === '/loop/status') {
    return json({ status: null })
  }

  // ── GET /api/events (SSE) ─────────────────────────────────────────────────
  if (req.method === 'GET' && apiPath === '/events') {
    const url = new URL(req.url)
    const sessionId = url.searchParams.get('session_id') ?? null

    const encoder = new TextEncoder()

    let controller: ReadableStreamDefaultController | null = null
    let pingInterval: ReturnType<typeof setInterval> | null = null

    const stream = new ReadableStream({
      start(ctrl) {
        controller = ctrl

        const client: SseClient = {
          sessionId,
          enqueue(event) {
            const data = `data: ${JSON.stringify(event)}\n\n`
            ctrl.enqueue(encoder.encode(data))
          },
          close() {
            try {
              ctrl.close()
            } catch {
              // already closed
            }
          },
        }
        sseClients.add(client)

        // Send initial busy-change=false so the UI knows the session is idle
        client.enqueue({ kind: 'busy-change', busy: false })

        // Periodic ping — must fire before Bun's idle timeout (set to 0 in
        // server.ts, but 8 s is also a safe floor for any reverse proxies)
        pingInterval = setInterval(() => {
          try {
            client.enqueue({ kind: 'ping' })
          } catch {
            clearInterval(pingInterval!)
            sseClients.delete(client)
          }
        }, 8_000)

        // Clean up when the stream is cancelled (client disconnects)
        // We store cleanup in a WeakRef-friendly closure by reusing `client`
        ;(ctrl as unknown as { _sseClient: SseClient })._sseClient = client
      },
      cancel() {
        if (pingInterval) clearInterval(pingInterval)
        if (controller) {
          const c = (controller as unknown as { _sseClient?: SseClient })._sseClient
          if (c) sseClients.delete(c)
        }
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    })
  }

  // ── Unknown route ─────────────────────────────────────────────────────────
  return null
}
