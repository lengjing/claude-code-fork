import { EventEmitter } from 'events'
import { PassThrough } from 'stream'
import { StructuredIO } from '../../cli/structuredIO.js'
import { runHeadless } from '../../cli/print.js'
import { ndjsonSafeStringify } from '../../cli/ndjsonSafeStringify.js'
import type { Command } from '../../commands.js'
import type { SDKStatus } from '../../entrypoints/agentSdkTypes.js'
import type { McpSdkServerConfig } from '../../services/mcp/types.js'
import type { AppState } from '../../state/AppStateStore.js'
import type { Tools } from '../../Tool.js'
import type { AgentDefinition } from '../../tools/AgentTool/loadAgentsDir.js'
import { errorMessage } from '../../utils/errors.js'
import type { ThinkingConfig } from '../../utils/thinking.js'
import type { ServerSessionProcess } from '../runtimeState.js'

type AppStateSetter = (f: (prev: AppState) => AppState) => void

type AsyncQueueResult = IteratorResult<string>

class AsyncStringQueue implements AsyncIterable<string>, AsyncIterator<string> {
  private readonly items: string[] = []
  private readonly waiters: Array<(result: AsyncQueueResult) => void> = []
  private closed = false

  push(value: string): void {
    if (this.closed) {
      return
    }
    const waiter = this.waiters.shift()
    if (waiter) {
      waiter({ value, done: false })
      return
    }
    this.items.push(value)
  }

  close(): void {
    if (this.closed) {
      return
    }
    this.closed = true
    while (this.waiters.length > 0) {
      this.waiters.shift()?.({ value: undefined as never, done: true })
    }
  }

  next(): Promise<AsyncQueueResult> {
    if (this.items.length > 0) {
      return Promise.resolve({ value: this.items.shift()!, done: false })
    }
    if (this.closed) {
      return Promise.resolve({ value: undefined as never, done: true })
    }
    return new Promise(resolve => {
      this.waiters.push(resolve)
    })
  }

  [Symbol.asyncIterator](): AsyncIterator<string> {
    return this
  }
}

class SessionStructuredIO extends StructuredIO {
  constructor(
    private readonly queue: AsyncStringQueue,
    private readonly onWrite: (line: string) => void,
  ) {
    super(queue)
  }

  pushInput(data: string): void {
    this.queue.push(data)
  }

  closeInput(): void {
    this.queue.close()
  }

  override write(message: Parameters<StructuredIO['write']>[0]): Promise<void> {
    this.onWrite(ndjsonSafeStringify(message) + '\n')
    return Promise.resolve()
  }
}

export type { ServerSessionProcess } from '../runtimeState.js'

type HeadlessSessionBaseOptions = {
  verbose?: boolean
  jsonSchema?: Record<string, unknown>
  permissionPromptToolName?: string
  allowedTools?: string[]
  thinkingConfig?: ThinkingConfig
  maxTurns?: number
  maxBudgetUsd?: number
  taskBudget?: { total: number }
  systemPrompt?: string
  appendSystemPrompt?: string
  userSpecifiedModel?: string
  fallbackModel?: string
  enableAuthStatus?: boolean
  agent?: string
  workload?: string
  setSDKStatus?: (status: SDKStatus) => void
}

export type DangerousBackendDeps = {
  createRuntime: (opts: {
    cwd: string
    dangerouslySkipPermissions?: boolean
    resumeSessionId?: string
  }) => Promise<{
    commands: Command[]
    tools: Tools
    sdkMcpConfigs: Record<string, McpSdkServerConfig>
    agents: AgentDefinition[]
    getAppState: () => AppState
    setAppState: AppStateSetter
    baseOptions: HeadlessSessionBaseOptions
  }>
}

export type SpawnedSession = {
  child: ServerSessionProcess
  workDir: string
}

class InProcessSessionChild
  extends EventEmitter
  implements ServerSessionProcess
{
  readonly stdout = new PassThrough()
  readonly stderr = new PassThrough()
  readonly stdin: { write: (chunk: string) => boolean }

  private closed = false
  private readonly sessionStructuredIO: SessionStructuredIO
  constructor(
    private readonly deps: DangerousBackendDeps,
    private readonly opts: {
      cwd: string
      dangerouslySkipPermissions?: boolean
      resumeSessionId?: string
    },
  ) {
    super()
    const inputQueue = new AsyncStringQueue()
    this.sessionStructuredIO = new SessionStructuredIO(
      inputQueue,
      line => {
        if (!this.closed) {
          this.stdout.write(line)
        }
      },
    )
    this.stdin = {
      write: (chunk: string) => {
        if (this.closed) {
          return false
        }
        this.sessionStructuredIO.pushInput(chunk)
        return true
      },
    }
  }

  start(): void {
    void this.deps.createRuntime(this.opts)
      .then(runtime => runHeadless(
        '',
        runtime.getAppState,
        runtime.setAppState,
        runtime.commands,
        runtime.tools,
        runtime.sdkMcpConfigs,
        runtime.agents,
        {
          continue: false,
          resume: this.opts.resumeSessionId,
          resumeSessionAt: undefined,
          verbose: runtime.baseOptions.verbose,
          outputFormat: 'stream-json',
          jsonSchema: runtime.baseOptions.jsonSchema,
          permissionPromptToolName:
            runtime.baseOptions.permissionPromptToolName,
          allowedTools: runtime.baseOptions.allowedTools,
          thinkingConfig: runtime.baseOptions.thinkingConfig,
          maxTurns: runtime.baseOptions.maxTurns,
          maxBudgetUsd: runtime.baseOptions.maxBudgetUsd,
          taskBudget: runtime.baseOptions.taskBudget,
          systemPrompt: runtime.baseOptions.systemPrompt,
          appendSystemPrompt: runtime.baseOptions.appendSystemPrompt,
          userSpecifiedModel: runtime.baseOptions.userSpecifiedModel,
          fallbackModel: runtime.baseOptions.fallbackModel,
          teleport: undefined,
          sdkUrl: undefined,
          replayUserMessages: false,
          includePartialMessages: false,
          forkSession: false,
          rewindFiles: undefined,
          enableAuthStatus: runtime.baseOptions.enableAuthStatus,
          agent: runtime.baseOptions.agent,
          workload: runtime.baseOptions.workload,
          setSDKStatus: runtime.baseOptions.setSDKStatus,
          structuredIO: this.sessionStructuredIO,
        },
      ))
      .then(() => {
        this.finish(0)
      })
      .catch(error => {
        if (!this.closed) {
          this.stderr.write(`server session failed: ${errorMessage(error)}\n`)
        }
        this.finish(1)
      })
  }

  kill(_signal?: string): void {
    this.finish(null)
  }

  private finish(code: number | null): void {
    if (this.closed) {
      return
    }
    this.closed = true
    this.sessionStructuredIO.closeInput()
    this.stdout.end()
    this.stderr.end()
    this.emit('exit', code)
  }
}

export class DangerousBackend {
  constructor(private readonly deps: DangerousBackendDeps) {}

  async spawnSession(opts: {
    cwd: string
    dangerouslySkipPermissions?: boolean
    resumeSessionId?: string
  }): Promise<SpawnedSession> {
    const child = new InProcessSessionChild(this.deps, opts)
    child.start()

    return {
      child,
      workDir: opts.cwd,
    }
  }
}
