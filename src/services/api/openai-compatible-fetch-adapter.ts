/**
 * OpenAI-compatible fetch adapter.
 *
 * Translates Anthropic Messages API requests into OpenAI-compatible
 * chat/completions requests so providers such as OpenAI, DeepSeek, and
 * DashScope/Qwen can be used behind the existing Anthropic SDK client.
 */

import {
  getOpenAICompatibleApiKey,
  getOpenAICompatibleBaseUrl,
} from '../../utils/auth.js'

type AnthropicImageSource = {
  type?: string
  media_type?: string
  data?: string
}

type AnthropicContentBlock = {
  type: string
  text?: string
  thinking?: string
  id?: string
  name?: string
  input?: Record<string, unknown>
  tool_use_id?: string
  content?: string | AnthropicContentBlock[]
  source?: AnthropicImageSource
}

type AnthropicMessage = {
  role: string
  content: string | AnthropicContentBlock[]
}

type AnthropicTool = {
  name: string
  description?: string
  input_schema?: Record<string, unknown>
}

type OpenAITextPart = {
  type: 'text'
  text: string
}

type OpenAIImagePart = {
  type: 'image_url'
  image_url: {
    url: string
  }
}

type OpenAIContentPart = OpenAITextPart | OpenAIImagePart

type OpenAIToolCall = {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

type OpenAIChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content?: string | OpenAIContentPart[] | null
  reasoning_content?: string
  tool_call_id?: string
  tool_calls?: OpenAIToolCall[]
}

type OpenAIChatCompletionChoice = {
  finish_reason?: string | null
  message?: {
    content?: string | null
    reasoning_content?: string | null
    tool_calls?: Array<{
      id?: string
      function?: {
        name?: string
        arguments?: string
      }
    }>
  }
}

type OpenAIChatCompletionResponse = {
  id?: string
  model?: string
  choices?: OpenAIChatCompletionChoice[]
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
  }
}

export type OpenAICompatibleVerificationConfig = {
  apiKey: string
  baseUrl: string
  model: string
}

async function readAnthropicBody(
  body: RequestInit['body'],
): Promise<Record<string, unknown>> {
  try {
    const text = await new Response(body ?? '{}').text()
    return text ? (JSON.parse(text) as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function stringifyToolResultContent(
  content: string | AnthropicContentBlock[] | undefined,
): string {
  if (typeof content === 'string') {
    return content
  }
  if (!Array.isArray(content)) {
    return ''
  }
  return content
    .map(block => {
      if (block.type === 'text' && typeof block.text === 'string') {
        return block.text
      }
      if (block.type === 'image') {
        return '[Image omitted]'
      }
      return ''
    })
    .filter(Boolean)
    .join('\n')
}

function translateMessages(
  anthropicMessages: AnthropicMessage[],
  systemPrompt:
    | string
    | Array<{ type: string; text?: string; cache_control?: unknown }>
    | undefined,
): OpenAIChatMessage[] {
  const openAIMessages: OpenAIChatMessage[] = []

  if (systemPrompt) {
    const instructions =
      typeof systemPrompt === 'string'
        ? systemPrompt
        : systemPrompt
            .filter(
              block => block.type === 'text' && typeof block.text === 'string',
            )
            .map(block => block.text)
            .join('\n')

    if (instructions.trim().length > 0) {
      openAIMessages.push({ role: 'system', content: instructions })
    }
  }

  let generatedToolCallCount = 0

  for (const message of anthropicMessages) {
    if (typeof message.content === 'string') {
      openAIMessages.push({
        role: message.role === 'assistant' ? 'assistant' : 'user',
        content: message.content,
      })
      continue
    }

    if (!Array.isArray(message.content)) {
      continue
    }

    if (message.role === 'user') {
      const contentParts: OpenAIContentPart[] = []

      const flushUserMessage = (): void => {
        if (contentParts.length === 0) {
          return
        }

        if (contentParts.length === 1 && contentParts[0]?.type === 'text') {
          openAIMessages.push({
            role: 'user',
            content: contentParts[0].text,
          })
        } else {
          openAIMessages.push({
            role: 'user',
            content: [...contentParts],
          })
        }
        contentParts.length = 0
      }

      for (const block of message.content) {
        if (block.type === 'tool_result') {
          flushUserMessage()
          openAIMessages.push({
            role: 'tool',
            tool_call_id:
              block.tool_use_id || `tool_call_${generatedToolCallCount++}`,
            content: stringifyToolResultContent(block.content),
          })
          continue
        }

        if (block.type === 'text' && typeof block.text === 'string') {
          contentParts.push({ type: 'text', text: block.text })
          continue
        }

        if (
          block.type === 'image' &&
          block.source?.type === 'base64' &&
          block.source.media_type &&
          block.source.data
        ) {
          contentParts.push({
            type: 'image_url',
            image_url: {
              url: `data:${block.source.media_type};base64,${block.source.data}`,
            },
          })
        }
      }

      flushUserMessage()
      continue
    }

    const textContent = message.content
      .filter(
        block => block.type === 'text' && typeof block.text === 'string',
      )
      .map(block => block.text)
      .join('\n')

    const reasoningContent = message.content
      .filter(
        block => block.type === 'thinking' && typeof block.thinking === 'string',
      )
      .map(block => block.thinking)
      .join('\n')

    const toolCalls = message.content
      .filter(block => block.type === 'tool_use')
      .map(block => ({
        id: block.id || `tool_call_${generatedToolCallCount++}`,
        type: 'function' as const,
        function: {
          name: block.name || '',
          arguments: JSON.stringify(block.input || {}),
        },
      }))

    if (textContent || reasoningContent || toolCalls.length > 0) {
      openAIMessages.push({
        role: 'assistant',
        content: textContent || null,
        ...(reasoningContent ? { reasoning_content: reasoningContent } : {}),
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      })
    }
  }

  return openAIMessages
}

function translateTools(
  anthropicTools: AnthropicTool[],
): Array<Record<string, unknown>> {
  return anthropicTools.map(tool => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description || '',
      parameters: tool.input_schema || { type: 'object', properties: {} },
    },
  }))
}

function translateRequestBody(
  anthropicBody: Record<string, unknown>,
): Record<string, unknown> {
  const tools = translateTools((anthropicBody.tools || []) as AnthropicTool[])
  const requestBody: Record<string, unknown> = {
    model: anthropicBody.model,
    messages: translateMessages(
      (anthropicBody.messages || []) as AnthropicMessage[],
      anthropicBody.system as
        | string
        | Array<{ type: string; text?: string; cache_control?: unknown }>
        | undefined,
    ),
    stream: anthropicBody.stream ?? true,
    stream_options: { include_usage: true },
  }

  if (typeof anthropicBody.max_tokens === 'number') {
    requestBody.max_tokens = anthropicBody.max_tokens
  }

  if (typeof anthropicBody.temperature === 'number') {
    requestBody.temperature = anthropicBody.temperature
  }

  if (Array.isArray(anthropicBody.stop_sequences)) {
    requestBody.stop = anthropicBody.stop_sequences
  }

  if (tools.length > 0) {
    requestBody.tools = tools
    requestBody.tool_choice = 'auto'
    requestBody.parallel_tool_calls = true
  }

  return requestBody
}

function buildChatCompletionsUrl(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/+$/, '')
  return normalized.endsWith('/chat/completions')
    ? normalized
    : `${normalized}/chat/completions`
}

function extractOpenAICompatibleErrorMessage(
  rawBody: string,
  fallback: string,
): string {
  try {
    const parsed = JSON.parse(rawBody) as {
      error?: { message?: string }
      message?: string
    }
    const message = parsed.error?.message ?? parsed.message
    return typeof message === 'string' && message.trim().length > 0
      ? message
      : fallback
  } catch {
    return rawBody.trim().length > 0 ? rawBody : fallback
  }
}

function formatSSE(event: string, data: string): string {
  return `event: ${event}\ndata: ${data}\n\n`
}

function mapFinishReason(
  finishReason: string | null | undefined,
  hasToolCalls: boolean,
): string {
  if (finishReason === 'length') {
    return 'max_tokens'
  }
  if (hasToolCalls || finishReason === 'tool_calls') {
    return 'tool_use'
  }
  return 'end_turn'
}

function safeParseJSONObject(value: string): Record<string, unknown> {
  try {
    return JSON.parse(value) as Record<string, unknown>
  } catch {
    return {}
  }
}

function translateNonStreamingResponse(
  responseBody: OpenAIChatCompletionResponse,
  model: string,
): Response {
  const choice = responseBody.choices?.[0]
  const contentBlocks: Array<Record<string, unknown>> = []

  if (
    choice?.message?.reasoning_content &&
    typeof choice.message.reasoning_content === 'string' &&
    choice.message.reasoning_content.length > 0
  ) {
    contentBlocks.push({
      type: 'thinking',
      thinking: choice.message.reasoning_content,
    })
  }

  if (
    choice?.message?.content &&
    typeof choice.message.content === 'string' &&
    choice.message.content.length > 0
  ) {
    contentBlocks.push({
      type: 'text',
      text: choice.message.content,
    })
  }

  for (const toolCall of choice?.message?.tool_calls ?? []) {
    contentBlocks.push({
      type: 'tool_use',
      id: toolCall.id || `toolu_${Date.now()}`,
      name: toolCall.function?.name || '',
      input: safeParseJSONObject(toolCall.function?.arguments || '{}'),
    })
  }

  return new Response(
    JSON.stringify({
      id: responseBody.id || `msg_openai_${Date.now()}`,
      type: 'message',
      role: 'assistant',
      model: responseBody.model || model,
      content: contentBlocks,
      stop_reason: mapFinishReason(
        choice?.finish_reason,
        (choice?.message?.tool_calls?.length ?? 0) > 0,
      ),
      stop_sequence: null,
      usage: {
        input_tokens: responseBody.usage?.prompt_tokens ?? 0,
        output_tokens: responseBody.usage?.completion_tokens ?? 0,
      },
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    },
  )
}

async function translateStreamingResponse(
  openAIResponse: Response,
  model: string,
): Promise<Response> {
  const messageId = `msg_openai_${Date.now()}`

  const readable = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()
      const decoder = new TextDecoder()
      const reader = openAIResponse.body?.getReader()

      if (!reader) {
        controller.close()
        return
      }

      let buffer = ''
      let contentBlockIndex = 0
      let inputTokens = 0
      let outputTokens = 0
      let textBlockStarted = false
      let thinkingBlockStarted = false
      let stopReason = 'end_turn'

      const toolStates = new Map<
        number,
        {
          sseIndex: number
          id: string
          name: string
          started: boolean
        }
      >()

      controller.enqueue(
        encoder.encode(
          formatSSE(
            'message_start',
            JSON.stringify({
              type: 'message_start',
              message: {
                id: messageId,
                type: 'message',
                role: 'assistant',
                content: [],
                model,
                stop_reason: null,
                stop_sequence: null,
                usage: { input_tokens: 0, output_tokens: 0 },
              },
            }),
          ),
        ),
      )

      controller.enqueue(
        encoder.encode(formatSSE('ping', JSON.stringify({ type: 'ping' }))),
      )

      const closeBlock = (index: number): void => {
        controller.enqueue(
          encoder.encode(
            formatSSE(
              'content_block_stop',
              JSON.stringify({
                type: 'content_block_stop',
                index,
              }),
            ),
          ),
        )
      }

      const closeTextBlock = (): void => {
        if (!textBlockStarted) {
          return
        }
        closeBlock(contentBlockIndex)
        contentBlockIndex += 1
        textBlockStarted = false
      }

      const closeThinkingBlock = (): void => {
        if (!thinkingBlockStarted) {
          return
        }
        closeBlock(contentBlockIndex)
        contentBlockIndex += 1
        thinkingBlockStarted = false
      }

      const ensureTextBlock = (): void => {
        if (textBlockStarted) {
          return
        }
        closeThinkingBlock()
        controller.enqueue(
          encoder.encode(
            formatSSE(
              'content_block_start',
              JSON.stringify({
                type: 'content_block_start',
                index: contentBlockIndex,
                content_block: { type: 'text', text: '' },
              }),
            ),
          ),
        )
        textBlockStarted = true
      }

      const ensureThinkingBlock = (): void => {
        if (thinkingBlockStarted) {
          return
        }
        closeTextBlock()
        controller.enqueue(
          encoder.encode(
            formatSSE(
              'content_block_start',
              JSON.stringify({
                type: 'content_block_start',
                index: contentBlockIndex,
                content_block: { type: 'thinking', thinking: '' },
              }),
            ),
          ),
        )
        thinkingBlockStarted = true
      }

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) {
            break
          }

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed.startsWith('data: ')) {
              continue
            }

            const payload = trimmed.slice(6)
            if (payload === '[DONE]') {
              continue
            }

            let chunk: Record<string, unknown>
            try {
              chunk = JSON.parse(payload) as Record<string, unknown>
            } catch {
              continue
            }

            const usage = chunk.usage as
              | { prompt_tokens?: number; completion_tokens?: number }
              | undefined
            if (usage) {
              inputTokens = usage.prompt_tokens ?? inputTokens
              outputTokens = usage.completion_tokens ?? outputTokens
            }

            const choice = Array.isArray(chunk.choices)
              ? (chunk.choices[0] as
                  | {
                      delta?: Record<string, unknown>
                      finish_reason?: string | null
                    }
                  | undefined)
              : undefined
            if (!choice) {
              continue
            }

            const delta = choice.delta || {}
            if (typeof delta.content === 'string' && delta.content.length > 0) {
              ensureTextBlock()
              controller.enqueue(
                encoder.encode(
                  formatSSE(
                    'content_block_delta',
                    JSON.stringify({
                      type: 'content_block_delta',
                      index: contentBlockIndex,
                      delta: { type: 'text_delta', text: delta.content },
                    }),
                  ),
                ),
              )
              outputTokens += 1
            }

            const reasoning =
              typeof delta.reasoning_content === 'string'
                ? delta.reasoning_content
                : typeof delta.reasoning === 'string'
                  ? delta.reasoning
                  : null
            if (reasoning) {
              ensureThinkingBlock()
              controller.enqueue(
                encoder.encode(
                  formatSSE(
                    'content_block_delta',
                    JSON.stringify({
                      type: 'content_block_delta',
                      index: contentBlockIndex,
                      delta: { type: 'thinking_delta', thinking: reasoning },
                    }),
                  ),
                ),
              )
              outputTokens += 1
            }

            if (Array.isArray(delta.tool_calls)) {
              closeTextBlock()
              closeThinkingBlock()

              for (const rawToolCall of delta.tool_calls as Array<
                Record<string, unknown>
              >) {
                const toolIndex =
                  typeof rawToolCall.index === 'number' ? rawToolCall.index : 0
                let toolState = toolStates.get(toolIndex)
                if (!toolState) {
                  toolState = {
                    sseIndex: contentBlockIndex++,
                    id: `toolu_${Date.now()}_${toolIndex}`,
                    name: '',
                    started: false,
                  }
                  toolStates.set(toolIndex, toolState)
                }

                const functionDelta =
                  rawToolCall.function as Record<string, unknown> | undefined
                if (typeof rawToolCall.id === 'string') {
                  toolState.id = rawToolCall.id
                }
                if (typeof functionDelta?.name === 'string') {
                  toolState.name = functionDelta.name
                }

                if (!toolState.started) {
                  controller.enqueue(
                    encoder.encode(
                      formatSSE(
                        'content_block_start',
                        JSON.stringify({
                          type: 'content_block_start',
                          index: toolState.sseIndex,
                          content_block: {
                            type: 'tool_use',
                            id: toolState.id,
                            name: toolState.name,
                            input: {},
                          },
                        }),
                      ),
                    ),
                  )
                  toolState.started = true
                }

                if (
                  typeof functionDelta?.arguments === 'string' &&
                  functionDelta.arguments.length > 0
                ) {
                  controller.enqueue(
                    encoder.encode(
                      formatSSE(
                        'content_block_delta',
                        JSON.stringify({
                          type: 'content_block_delta',
                          index: toolState.sseIndex,
                          delta: {
                            type: 'input_json_delta',
                            partial_json: functionDelta.arguments,
                          },
                        }),
                      ),
                    ),
                  )
                }
              }
            }

            if (choice.finish_reason) {
              stopReason = mapFinishReason(
                choice.finish_reason,
                toolStates.size > 0,
              )
            }
          }
        }
      } finally {
        closeTextBlock()
        closeThinkingBlock()
        for (const toolState of toolStates.values()) {
          if (toolState.started) {
            closeBlock(toolState.sseIndex)
          }
        }

        controller.enqueue(
          encoder.encode(
            formatSSE(
              'message_delta',
              JSON.stringify({
                type: 'message_delta',
                delta: { stop_reason: stopReason, stop_sequence: null },
                usage: { output_tokens: outputTokens },
              }),
            ),
          ),
        )

        controller.enqueue(
          encoder.encode(
            formatSSE(
              'message_stop',
              JSON.stringify({
                type: 'message_stop',
                usage: {
                  input_tokens: inputTokens,
                  output_tokens: outputTokens,
                },
              }),
            ),
          ),
        )

        controller.close()
      }
    },
  })

  return new Response(readable, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'x-request-id': messageId,
    },
  })
}

async function createErrorResponse(response: Response): Promise<Response> {
  const message = await response.text().catch(() => response.statusText)
  return new Response(
    JSON.stringify({
      type: 'error',
      error: {
        type: 'api_error',
        message: `OpenAI-compatible API error (${response.status}): ${message}`,
      },
    }),
    {
      status: response.status,
      headers: { 'Content-Type': 'application/json' },
    },
  )
}

export async function verifyOpenAICompatibleConfig(
  config: OpenAICompatibleVerificationConfig,
): Promise<void> {
  let upstreamResponse: Response

  try {
    upstreamResponse = await globalThis.fetch(
      buildChatCompletionsUrl(config.baseUrl),
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          messages: [{ role: 'user', content: 'test' }],
          max_tokens: 1,
          stream: false,
        }),
      },
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(
      `Unable to reach the OpenAI-compatible API. Check the base URL and network connection. ${message}`,
    )
  }

  if (upstreamResponse.ok) {
    return
  }

  const fallbackMessage = upstreamResponse.statusText || 'Request failed'
  const responseBody = await upstreamResponse.text().catch(() => '')
  const message = extractOpenAICompatibleErrorMessage(
    responseBody,
    fallbackMessage,
  )

  if (upstreamResponse.status === 401 || upstreamResponse.status === 403) {
    throw new Error(
      `Authentication failed. Please check the API key. ${message}`,
    )
  }

  if (upstreamResponse.status === 404) {
    throw new Error(
      `OpenAI-compatible endpoint not found. Please check the base URL. ${message}`,
    )
  }

  throw new Error(
    `OpenAI-compatible API validation failed (${upstreamResponse.status}). ${message}`,
  )
}

export function createOpenAICompatibleFetch(): (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response> {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input)
    if (!url.includes('/v1/messages')) {
      return globalThis.fetch(input, init)
    }

    const apiKey = getOpenAICompatibleApiKey()
    if (!apiKey) {
      return new Response(
        JSON.stringify({
          type: 'error',
          error: {
            type: 'authentication_error',
            message:
              'OPENAI_API_KEY is required when using the OpenAI-compatible provider.',
          },
        }),
        {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        },
      )
    }

    const anthropicBody = await readAnthropicBody(init?.body)
    const requestBody = translateRequestBody(anthropicBody)
    const targetModel =
      typeof anthropicBody.model === 'string' ? anthropicBody.model : 'unknown'

    const upstreamResponse = await globalThis.fetch(
      buildChatCompletionsUrl(getOpenAICompatibleBaseUrl()),
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept:
            anthropicBody.stream === false
              ? 'application/json'
              : 'text/event-stream',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(requestBody),
      },
    )

    if (!upstreamResponse.ok) {
      return createErrorResponse(upstreamResponse)
    }

    if (anthropicBody.stream === false) {
      const responseBody =
        (await upstreamResponse.json()) as OpenAIChatCompletionResponse
      return translateNonStreamingResponse(responseBody, targetModel)
    }

    return translateStreamingResponse(upstreamResponse, targetModel)
  }
}
