import type { EventEmitter } from 'events'
import type { PassThrough } from 'stream'

export type ServerSessionProcess = {
  stdin: { write: (chunk: string) => boolean }
  stdout: PassThrough
  stderr: PassThrough
  on: (event: 'exit', listener: (code: number | null) => void) => EventEmitter
  kill: (_signal?: string) => void
}
