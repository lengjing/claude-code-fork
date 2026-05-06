/* eslint-disable eslint-plugin-n/no-unsupported-features/node-builtins */

import { createInterface } from 'readline'
import type { SDKMessage } from '../entrypoints/agentSdkTypes.js'
import {
  type DirectConnectConfig,
  DirectConnectSessionManager,
} from './directConnectManager.js'

type OutputFormat = 'text' | 'json' | 'stream-json'

function extractAssistantText(message: SDKMessage): string {
  if (message.type !== 'assistant') {
    return ''
  }

  const blocks = message.message?.content
  if (!Array.isArray(blocks)) {
    return ''
  }

  const parts: string[] = []
  for (const block of blocks) {
    if (
      typeof block === 'object' &&
      block !== null &&
      'type' in block &&
      (block as { type?: unknown }).type === 'text' &&
      'text' in block
    ) {
      const text = (block as { text?: unknown }).text
      if (typeof text === 'string') {
        parts.push(text)
      }
    }
  }

  return parts.join('')
}

function writeStreamJson(message: SDKMessage): void {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

function writeText(text: string): void {
  if (!text) {
    return
  }
  process.stdout.write(`${text}\n`)
}

export async function runConnectHeadless(
  config: DirectConnectConfig,
  prompt: string,
  outputFormat: string,
  interactive: boolean,
): Promise<void> {
  const format: OutputFormat =
    outputFormat === 'json' || outputFormat === 'stream-json'
      ? outputFormat
      : 'text'

  let lastAssistantText = ''
  let doneResolve: (() => void) | null = null
  const done = new Promise<void>(resolve => {
    doneResolve = resolve
  })

  const manager = new DirectConnectSessionManager(config, {
    onConnected: () => {
      if (prompt) {
        manager.sendMessage(prompt)
      }

      if (interactive) {
        const rl = createInterface({
          input: process.stdin,
          crlfDelay: Infinity,
        })
        rl.on('line', line => {
          const trimmed = line.trim()
          if (!trimmed) {
            return
          }
          manager.sendMessage(trimmed)
        })
      }
    },
    onMessage: message => {
      if (format === 'stream-json') {
        writeStreamJson(message)
      }

      const text = extractAssistantText(message)
      if (text) {
        lastAssistantText = text
        if (format === 'text') {
          writeText(text)
        }
      }

      if (message.type === 'result' && !interactive) {
        if (format === 'json') {
          process.stdout.write(`${JSON.stringify({ result: lastAssistantText })}\n`)
        }
        doneResolve?.()
      }
    },
    onPermissionRequest: (_request, requestId) => {
      manager.respondToPermissionRequest(requestId, {
        behavior: 'deny',
        message: 'Headless mode does not support interactive permission prompts',
      })
    },
    onDisconnected: () => {
      doneResolve?.()
    },
    onError: err => {
      process.stderr.write(`${err.message}\n`)
      doneResolve?.()
    },
  })

  manager.connect()
  await done
  manager.disconnect()
}
