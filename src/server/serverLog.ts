export type ServerLogger = {
  info: (message: string) => void
  warn: (message: string) => void
  error: (message: string) => void
}

function stamp(level: string, message: string): string {
  return `[claude-server ${level}] ${message}`
}

export function createServerLogger(): ServerLogger {
  return {
    info(message: string) {
      process.stderr.write(`${stamp('info', message)}\n`)
    },
    warn(message: string) {
      process.stderr.write(`${stamp('warn', message)}\n`)
    },
    error(message: string) {
      process.stderr.write(`${stamp('error', message)}\n`)
    },
  }
}
