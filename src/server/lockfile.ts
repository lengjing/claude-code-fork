import { mkdir, readFile, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { getClaudeConfigHomeDir } from '../utils/envUtils.js'

type ServerLock = {
  pid: number
  port: number
  host: string
  httpUrl: string
  startedAt: number
}

function getLockPath(): string {
  return join(getClaudeConfigHomeDir(), 'server.lock.json')
}

export async function writeServerLock(lock: ServerLock): Promise<void> {
  const lockPath = getLockPath()
  await mkdir(getClaudeConfigHomeDir(), { recursive: true })
  await writeFile(lockPath, JSON.stringify(lock), 'utf8')
}

export async function removeServerLock(): Promise<void> {
  const lockPath = getLockPath()
  await rm(lockPath, { force: true })
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export async function probeRunningServer(): Promise<ServerLock | null> {
  const lockPath = getLockPath()
  let parsed: ServerLock
  try {
    const raw = await readFile(lockPath, 'utf8')
    parsed = JSON.parse(raw) as ServerLock
  } catch {
    return null
  }

  if (!parsed || typeof parsed.pid !== 'number') {
    await removeServerLock()
    return null
  }

  if (!isProcessAlive(parsed.pid)) {
    await removeServerLock()
    return null
  }

  return parsed
}
