import { mkdir, readFile, readdir, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { getClaudeConfigHomeDir } from '../utils/envUtils.js'

export type ServerLock = {
  pid: number
  port: number
  host: string
  httpUrl: string
  startedAt: number
}

function getLocksDir(): string {
  return join(getClaudeConfigHomeDir(), 'server-locks')
}

function getLockFilePath(pid: number): string {
  return join(getLocksDir(), `${pid}.lock.json`)
}

export async function writeServerLock(lock: ServerLock): Promise<void> {
  const locksDir = getLocksDir()
  await mkdir(locksDir, { recursive: true })
  await writeFile(getLockFilePath(lock.pid), JSON.stringify(lock), 'utf8')
}

export async function removeServerLock(): Promise<void> {
  await rm(getLockFilePath(process.pid), { force: true })
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export async function listRunningServers(): Promise<ServerLock[]> {
  const locksDir = getLocksDir()
  let files: string[]
  try {
    files = await readdir(locksDir)
  } catch {
    return []
  }

  const result: ServerLock[] = []
  for (const file of files) {
    if (!file.endsWith('.lock.json')) continue
    const filePath = join(locksDir, file)
    let parsed: ServerLock
    try {
      const raw = await readFile(filePath, 'utf8')
      parsed = JSON.parse(raw) as ServerLock
    } catch {
      continue
    }

    if (!parsed || typeof parsed.pid !== 'number') {
      await rm(filePath, { force: true })
      continue
    }

    if (!isProcessAlive(parsed.pid)) {
      await rm(filePath, { force: true })
      continue
    }

    result.push(parsed)
  }
  return result
}
