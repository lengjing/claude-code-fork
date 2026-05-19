import type { ChildProcess } from 'child_process'
import { z } from 'zod/v4'
import { lazySchema } from '../utils/lazySchema.js'

export const connectResponseSchema = lazySchema(() =>
  z.object({
    session_id: z.string(),
    ws_url: z.string(),
    work_dir: z.string().optional(),
  }),
)

export type ServerConfig = {
  port: number
  host: string
  authToken?: string
  unix?: string
  /** Idle timeout for detached sessions (ms). 0 = never expire. */
  idleTimeoutMs?: number
  /** Maximum number of concurrent sessions. */
  maxSessions?: number
  /** Default workspace directory for sessions that don't specify cwd. */
  workspace?: string
  /**
   * When true, serve the Claude Code dashboard SPA and expose /api/* endpoints.
   * The dashboard assets are loaded from the `dashboard/dist/assets/` directory
   * resolved relative to the server binary location.
   */
  dashboard?: boolean
}

export type SessionState =
  | 'starting'
  | 'running'
  | 'detached'
  | 'stopping'
  | 'stopped'

export type SessionInfo = {
  id: string
  status: SessionState
  createdAt: number
  workDir: string
  process: ChildProcess | null
  sessionKey?: string
}

export type ListedSessionStatus = 'running' | 'detached' | 'persisted'

export type ListedSession = {
  sessionId: string
  summary?: string
  lastModified?: number
  fileSize?: number
  customTitle?: string
  firstPrompt?: string
  gitBranch?: string
  cwd?: string
  tag?: string
  createdAt?: number
  lastActiveAt?: number
  active: boolean
  attachedClients: number
  status: ListedSessionStatus
}
