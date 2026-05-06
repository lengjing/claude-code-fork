import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'
import { installOAuthTokens } from '../cli/handlers/auth.js'
import { useTerminalSize } from '../hooks/useTerminalSize.js'
import { setClipboard } from '../ink/termio/osc.js'
import { useTerminalNotification } from '../ink/useTerminalNotification.js'
import { Box, Link, Text } from '../ink.js'
import { useKeybinding } from '../keybindings/useKeybinding.js'
import { getSSLErrorHint } from '../services/api/errorUtils.js'
import { verifyOpenAICompatibleConfig } from '../services/api/openai-compatible-fetch-adapter.js'
import { sendNotification } from '../services/notifier.js'
import { runCodexOAuthFlow } from '../services/oauth/codex-client.js'
import { OAuthService } from '../services/oauth/index.js'
import {
  activateAnthropicProvider,
  activateCodexProvider,
  getOauthAccountInfo,
  saveCodexOAuthTokens,
  saveOpenAICompatibleProviderConfig,
  validateForceLoginOrg,
} from '../utils/auth.js'
import { applyConfigEnvironmentVariables } from '../utils/managedEnv.js'
import { logError } from '../utils/log.js'
import { getSettings_DEPRECATED } from '../utils/settings/settings.js'
import { Select } from './CustomSelect/select.js'
import { KeyboardShortcutHint } from './design-system/KeyboardShortcutHint.js'
import { Spinner } from './Spinner.js'
import TextInput from './TextInput.js'

type Props = {
  onDone(): void
  startingMessage?: string
  mode?: 'login' | 'setup-token'
  forceLoginMethod?: 'claudeai' | 'console'
}

type OpenAICompatiblePreset = 'openai' | 'deepseek' | 'qwen' | 'custom'

type OpenAICompatibleSetupState = {
  state: 'openai_setup'
  preset: OpenAICompatiblePreset
  baseUrl: string
  apiKey: string
  model: string
  step: 'base_url' | 'api_key' | 'model'
}

type OAuthStatus =
  | { state: 'idle' }
  | { state: 'platform_setup' }
  | { state: 'openai_provider_select' }
  | { state: 'ready_to_start' }
  | { state: 'waiting_for_login'; url: string }
  | { state: 'creating_api_key' }
  | { state: 'saving_openai_config' }
  | { state: 'about_to_retry'; nextState: OAuthStatus }
  | { state: 'success'; token?: string }
  | { state: 'error'; message: string; toRetry?: OAuthStatus }
  | OpenAICompatibleSetupState

const PASTE_HERE_MSG = 'Paste code here if prompted > '

const OPENAI_COMPATIBLE_PRESETS: Array<{
  value: OpenAICompatiblePreset
  label: React.ReactNode
  baseUrl: string
  model: string
}> = [
  {
    value: 'deepseek',
    label: (
      <Text>
        DeepSeek API · <Text dimColor={true}>OpenAI-compatible</Text>
      </Text>
    ),
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-v4-flash',
  },
  {
    value: 'qwen',
    label: (
      <Text>
        Qwen / DashScope · <Text dimColor={true}>Aliyun compatible-mode</Text>
      </Text>
    ),
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus',
  },
  {
    value: 'openai',
    label: (
      <Text>
        OpenAI API · <Text dimColor={true}>Official OpenAI-compatible API</Text>
      </Text>
    ),
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4.1',
  },
  {
    value: 'custom',
    label: (
      <Text>
        Custom endpoint · <Text dimColor={true}>Any OpenAI-compatible gateway</Text>
      </Text>
    ),
    baseUrl: '',
    model: '',
  },
]

function createOpenAISetupState(
  preset: OpenAICompatiblePreset,
): OpenAICompatibleSetupState {
  const selectedPreset =
    OPENAI_COMPATIBLE_PRESETS.find(option => option.value === preset) ??
    OPENAI_COMPATIBLE_PRESETS[0]

  return {
    state: 'openai_setup',
    preset,
    baseUrl: selectedPreset?.baseUrl ?? '',
    apiKey: '',
    model: selectedPreset?.model ?? '',
    step: preset === 'custom' ? 'base_url' : 'api_key',
  }
}

function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export function ConsoleOAuthFlow({
  onDone,
  startingMessage,
  mode = 'login',
  forceLoginMethod: forceLoginMethodProp,
}: Props): React.ReactNode {
  const settings = getSettings_DEPRECATED() || {}
  const forceLoginMethod = forceLoginMethodProp ?? settings.forceLoginMethod
  const orgUUID = settings.forceLoginOrgUUID
  const forcedMethodMessage =
    forceLoginMethod === 'claudeai'
      ? 'Login method pre-selected: Subscription Plan (Claude Pro/Max)'
      : forceLoginMethod === 'console'
        ? 'Login method pre-selected: API Usage Billing (Anthropic Console)'
        : null

  const terminal = useTerminalNotification()
  const [oauthStatus, setOAuthStatus] = useState<OAuthStatus>(() => {
    if (mode === 'setup-token') {
      return { state: 'ready_to_start' }
    }
    if (forceLoginMethod === 'claudeai' || forceLoginMethod === 'console') {
      return { state: 'ready_to_start' }
    }
    return { state: 'idle' }
  })
  const [pastedCode, setPastedCode] = useState('')
  const [cursorOffset, setCursorOffset] = useState(0)
  const [oauthService] = useState(() => new OAuthService())
  const [loginWithClaudeAi, setLoginWithClaudeAi] = useState(
    () => mode === 'setup-token' || forceLoginMethod === 'claudeai',
  )
  const [loginWithCodex, setLoginWithCodex] = useState(false)
  const [showPastePrompt, setShowPastePrompt] = useState(false)
  const [urlCopied, setUrlCopied] = useState(false)
  const [openAIInput, setOpenAIInput] = useState('')
  const [openAIInputCursorOffset, setOpenAIInputCursorOffset] = useState(0)
  const textInputColumns = useTerminalSize().columns - PASTE_HERE_MSG.length - 1

  useEffect(() => {
    if (forceLoginMethod === 'claudeai') {
      logEvent('tengu_oauth_claudeai_forced', {})
    } else if (forceLoginMethod === 'console') {
      logEvent('tengu_oauth_console_forced', {})
    }
  }, [forceLoginMethod])

  useEffect(() => {
    if (oauthStatus.state === 'about_to_retry') {
      const timer = setTimeout(setOAuthStatus, 1000, oauthStatus.nextState)
      return () => clearTimeout(timer)
    }
  }, [oauthStatus])

  useEffect(() => {
    if (oauthStatus.state !== 'openai_setup') {
      return
    }

    const currentValue =
      oauthStatus.step === 'base_url'
        ? oauthStatus.baseUrl
        : oauthStatus.step === 'api_key'
          ? oauthStatus.apiKey
          : oauthStatus.model

    setOpenAIInput(currentValue)
    setOpenAIInputCursorOffset(0)
  }, [oauthStatus])

  useKeybinding(
    'confirm:yes',
    () => {
      logEvent('tengu_oauth_success', { loginWithClaudeAi })
      onDone()
    },
    {
      context: 'Confirmation',
      isActive: oauthStatus.state === 'success' && mode !== 'setup-token',
    },
  )

  useKeybinding(
    'confirm:yes',
    () => {
      setOAuthStatus({ state: 'idle' })
    },
    {
      context: 'Confirmation',
      isActive: oauthStatus.state === 'platform_setup',
    },
  )

  useKeybinding(
    'confirm:yes',
    () => {
      if (oauthStatus.state === 'error' && oauthStatus.toRetry) {
        setPastedCode('')
        setOAuthStatus({
          state: 'about_to_retry',
          nextState: oauthStatus.toRetry,
        })
      }
    },
    {
      context: 'Confirmation',
      isActive: oauthStatus.state === 'error' && !!oauthStatus.toRetry,
    },
  )

  useEffect(() => {
    if (
      pastedCode === 'c' &&
      oauthStatus.state === 'waiting_for_login' &&
      showPastePrompt &&
      !urlCopied
    ) {
      void setClipboard(oauthStatus.url).then(raw => {
        if (raw) process.stdout.write(raw)
        setUrlCopied(true)
        setTimeout(setUrlCopied, 2000, false)
      })
      setPastedCode('')
    }
  }, [pastedCode, oauthStatus, showPastePrompt, urlCopied])

  async function handleSubmitCode(value: string, url: string) {
    try {
      const [authorizationCode, state] = value.split('#')
      if (!authorizationCode || !state) {
        setOAuthStatus({
          state: 'error',
          message: 'Invalid code. Please make sure the full code was copied',
          toRetry: { state: 'waiting_for_login', url },
        })
        return
      }

      logEvent('tengu_oauth_manual_entry', {})
      oauthService.handleManualAuthCodeInput({ authorizationCode, state })
    } catch (err: unknown) {
      logError(err)
      setOAuthStatus({
        state: 'error',
        message: (err as Error).message,
        toRetry: { state: 'waiting_for_login', url },
      })
    }
  }

  const startOAuth = useCallback(async () => {
    try {
      logEvent('tengu_oauth_flow_start', { loginWithClaudeAi })

      const result = await oauthService
        .startOAuthFlow(
          async url => {
            setOAuthStatus({ state: 'waiting_for_login', url })
            setTimeout(setShowPastePrompt, 3000, true)
          },
          {
            loginWithClaudeAi,
            inferenceOnly: mode === 'setup-token',
            expiresIn:
              mode === 'setup-token' ? 365 * 24 * 60 * 60 : undefined,
            orgUUID,
          },
        )
        .catch(err => {
          const isTokenExchangeError = err.message.includes(
            'Token exchange failed',
          )
          const sslHint = getSSLErrorHint(err)
          setOAuthStatus({
            state: 'error',
            message:
              sslHint ??
              (isTokenExchangeError
                ? 'Failed to exchange authorization code for access token. Please try again.'
                : err.message),
            toRetry:
              mode === 'setup-token'
                ? { state: 'ready_to_start' }
                : { state: 'idle' },
          })
          logEvent('tengu_oauth_token_exchange_error', {
            error: err.message,
            ssl_error: sslHint !== null,
          })
          throw err
        })

      if (mode === 'setup-token') {
        setOAuthStatus({ state: 'success', token: result.accessToken })
        return
      }

      await installOAuthTokens(result)
      activateAnthropicProvider()
      applyConfigEnvironmentVariables()

      const orgResult = await validateForceLoginOrg()
      if (!orgResult.valid) {
        throw new Error(
          'message' in orgResult ? orgResult.message : 'Invalid organization',
        )
      }

      setOAuthStatus({ state: 'success' })
      void sendNotification(
        {
          message: 'Claude Code login successful',
          notificationType: 'auth_success',
        },
        terminal,
      )
    } catch (err) {
      const errorMessage = (err as Error).message
      const sslHint = getSSLErrorHint(err)
      setOAuthStatus({
        state: 'error',
        message: sslHint ?? errorMessage,
        toRetry: {
          state: mode === 'setup-token' ? 'ready_to_start' : 'idle',
        },
      })
      logEvent('tengu_oauth_error', {
        error:
          errorMessage as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        ssl_error: sslHint !== null,
      })
    }
  }, [oauthService, terminal, loginWithClaudeAi, mode, orgUUID])

  const startCodexOAuth = useCallback(async () => {
    try {
      logEvent('tengu_oauth_codex_flow_start', {})
      const codexTokens = await runCodexOAuthFlow(async url => {
        setOAuthStatus({ state: 'waiting_for_login', url })
        setTimeout(setShowPastePrompt, 3000, true)
      })

      saveCodexOAuthTokens(codexTokens)
      activateCodexProvider()
      applyConfigEnvironmentVariables()

      logEvent('tengu_oauth_codex_success', {})
      setOAuthStatus({ state: 'success' })
      void sendNotification(
        {
          message: 'Codex login successful',
          notificationType: 'auth_success',
        },
        terminal,
      )
    } catch (err) {
      const message = (err as Error).message
      logEvent('tengu_oauth_codex_error', {
        error:
          message as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
      setOAuthStatus({
        state: 'error',
        message,
        toRetry: { state: 'idle' },
      })
    }
  }, [terminal])

  const saveOpenAICompatibleConfig = useCallback(
    async (state: OpenAICompatibleSetupState) => {
      try {
        setOAuthStatus({ state: 'saving_openai_config' })
        await verifyOpenAICompatibleConfig({
          apiKey: state.apiKey,
          baseUrl: state.baseUrl,
          model: state.model,
        })
        saveOpenAICompatibleProviderConfig({
          apiKey: state.apiKey,
          baseUrl: state.baseUrl,
          model: state.model,
        })
        applyConfigEnvironmentVariables()

        logEvent('tengu_oauth_openai_compatible_success', {
          provider:
            state.preset as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        })
        setOAuthStatus({ state: 'success' })
        void sendNotification(
          {
            message: 'OpenAI-compatible provider configured',
            notificationType: 'auth_success',
          },
          terminal,
        )
      } catch (err) {
        setOAuthStatus({
          state: 'error',
          message: (err as Error).message,
          toRetry: state,
        })
      }
    },
    [terminal],
  )

  const handleOpenAISetupSubmit = useCallback(
    async (value: string) => {
      if (oauthStatus.state !== 'openai_setup') {
        return
      }

      const trimmed = value.trim()
      if (oauthStatus.step === 'base_url') {
        if (!trimmed || !isValidHttpUrl(trimmed)) {
          setOAuthStatus({
            state: 'error',
            message: 'Please enter a valid http(s) base URL.',
            toRetry: oauthStatus,
          })
          return
        }
        setOAuthStatus({
          ...oauthStatus,
          baseUrl: trimmed,
          step: 'api_key',
        })
        return
      }

      if (oauthStatus.step === 'api_key') {
        if (!trimmed) {
          setOAuthStatus({
            state: 'error',
            message: 'API key cannot be empty.',
            toRetry: oauthStatus,
          })
          return
        }
        setOAuthStatus({
          ...oauthStatus,
          apiKey: trimmed,
          step: 'model',
        })
        return
      }

      if (!trimmed) {
        setOAuthStatus({
          state: 'error',
          message: 'Model cannot be empty.',
          toRetry: oauthStatus,
        })
        return
      }

      await saveOpenAICompatibleConfig({
        ...oauthStatus,
        model: trimmed,
      })
    },
    [oauthStatus, saveOpenAICompatibleConfig],
  )

  const handleOpenAISetupCancel = useCallback(() => {
    if (oauthStatus.state !== 'openai_setup') {
      return
    }

    if (oauthStatus.step === 'model') {
      setOAuthStatus({
        ...oauthStatus,
        step: 'api_key',
      })
      return
    }

    if (oauthStatus.step === 'api_key') {
      if (oauthStatus.preset === 'custom') {
        setOAuthStatus({
          ...oauthStatus,
          step: 'base_url',
        })
      } else {
        setOAuthStatus({ state: 'openai_provider_select' })
      }
      return
    }

    setOAuthStatus({ state: 'openai_provider_select' })
  }, [oauthStatus])

  useKeybinding('confirm:no', handleOpenAISetupCancel, {
    context: 'Settings',
    isActive: oauthStatus.state === 'openai_setup',
  })

  const pendingOAuthStartRef = useRef(false)
  useEffect(() => {
    if (
      oauthStatus.state === 'ready_to_start' &&
      !pendingOAuthStartRef.current
    ) {
      pendingOAuthStartRef.current = true
      if (loginWithCodex) {
        process.nextTick(() => {
          void startCodexOAuth()
          pendingOAuthStartRef.current = false
        })
      } else {
        process.nextTick(() => {
          void startOAuth()
          pendingOAuthStartRef.current = false
        })
      }
    }
  }, [oauthStatus.state, loginWithCodex, startCodexOAuth, startOAuth])

  useEffect(() => {
    if (mode === 'setup-token' && oauthStatus.state === 'success') {
      const timer = setTimeout(() => {
        logEvent('tengu_oauth_success', { loginWithClaudeAi })
        onDone()
      }, 500)
      return () => clearTimeout(timer)
    }
  }, [mode, oauthStatus, loginWithClaudeAi, onDone])

  useEffect(() => {
    return () => {
      oauthService.cleanup()
    }
  }, [oauthService])

  return (
    <Box flexDirection="column" gap={1}>
      {oauthStatus.state === 'waiting_for_login' && showPastePrompt ? (
        <Box flexDirection="column" key="urlToCopy" gap={1} paddingBottom={1}>
          <Box paddingX={1}>
            <Text dimColor={true}>
              Browser didn&apos;t open? Use the url below to sign in{' '}
            </Text>
            {urlCopied ? (
              <Text color="success">(Copied!)</Text>
            ) : (
              <Text dimColor={true}>
                <KeyboardShortcutHint shortcut="c" action="copy" parens={true} />
              </Text>
            )}
          </Box>
          <Link url={oauthStatus.url}>
            <Text dimColor={true}>{oauthStatus.url}</Text>
          </Link>
        </Box>
      ) : null}

      {mode === 'setup-token' &&
      oauthStatus.state === 'success' &&
      oauthStatus.token ? (
        <Box key="tokenOutput" flexDirection="column" gap={1} paddingTop={1}>
          <Text color="success">
            ✓ Long-lived authentication token created successfully!
          </Text>
          <Box flexDirection="column" gap={1}>
            <Text>Your OAuth token (valid for 1 year):</Text>
            <Text color="warning">{oauthStatus.token}</Text>
            <Text dimColor={true}>
              Store this token securely. You won&apos;t be able to see it again.
            </Text>
            <Text dimColor={true}>
              Use this token by setting: export
              {' '}
              CLAUDE_CODE_OAUTH_TOKEN=&lt;token&gt;
            </Text>
          </Box>
        </Box>
      ) : null}

      <Box paddingLeft={1} flexDirection="column" gap={1}>
        <OAuthStatusMessage
          oauthStatus={oauthStatus}
          mode={mode}
          startingMessage={startingMessage}
          forcedMethodMessage={forcedMethodMessage}
          showPastePrompt={showPastePrompt}
          pastedCode={pastedCode}
          setPastedCode={setPastedCode}
          cursorOffset={cursorOffset}
          setCursorOffset={setCursorOffset}
          textInputColumns={textInputColumns}
          handleSubmitCode={handleSubmitCode}
          setOAuthStatus={setOAuthStatus}
          setLoginWithClaudeAi={setLoginWithClaudeAi}
          setLoginWithCodex={setLoginWithCodex}
          openAIInput={openAIInput}
          setOpenAIInput={setOpenAIInput}
          openAIInputCursorOffset={openAIInputCursorOffset}
          setOpenAIInputCursorOffset={setOpenAIInputCursorOffset}
          handleOpenAISetupSubmit={handleOpenAISetupSubmit}
        />
      </Box>
    </Box>
  )
}

type OAuthStatusMessageProps = {
  oauthStatus: OAuthStatus
  mode: 'login' | 'setup-token'
  startingMessage?: string
  forcedMethodMessage: string | null
  showPastePrompt: boolean
  pastedCode: string
  setPastedCode(value: string): void
  cursorOffset: number
  setCursorOffset(offset: number): void
  textInputColumns: number
  handleSubmitCode(value: string, url: string): void
  setOAuthStatus(status: OAuthStatus): void
  setLoginWithClaudeAi(value: boolean): void
  setLoginWithCodex(value: boolean): void
  openAIInput: string
  setOpenAIInput(value: string): void
  openAIInputCursorOffset: number
  setOpenAIInputCursorOffset(offset: number): void
  handleOpenAISetupSubmit(value: string): Promise<void>
}

function OAuthStatusMessage({
  oauthStatus,
  mode,
  startingMessage,
  forcedMethodMessage,
  showPastePrompt,
  pastedCode,
  setPastedCode,
  cursorOffset,
  setCursorOffset,
  textInputColumns,
  handleSubmitCode,
  setOAuthStatus,
  setLoginWithClaudeAi,
  setLoginWithCodex,
  openAIInput,
  setOpenAIInput,
  openAIInputCursorOffset,
  setOpenAIInputCursorOffset,
  handleOpenAISetupSubmit,
}: OAuthStatusMessageProps): React.ReactNode {
  const openAICompatiblePrompt = useMemo(() => {
    if (oauthStatus.state !== 'openai_setup') {
      return null
    }

    if (oauthStatus.step === 'base_url') {
      return {
        title: 'Enter the OpenAI-compatible base URL',
        subtitle:
          'Examples: https://api.deepseek.com/v1, https://dashscope.aliyuncs.com/compatible-mode/v1',
        mask: undefined,
      }
    }

    if (oauthStatus.step === 'api_key') {
      return {
        title: 'Enter the API key for this provider',
        subtitle: 'This will be stored in your Claude Code user config.',
        mask: '*',
      }
    }

    return {
      title: 'Enter the default model ID to use',
      subtitle:
        'Examples: deepseek-v4-flash, deepseek-v4-pro, qwen-plus, qwen-max, gpt-4.1, or your gateway-specific model ID.',
      mask: undefined,
    }
  }, [oauthStatus])

  switch (oauthStatus.state) {
    case 'idle':
      return (
        <Box flexDirection="column" gap={1} marginTop={1}>
          <Text bold={true}>
            {startingMessage ??
              'Claude Code can be used with your Claude subscription or billed based on API usage through your Console account.'}
          </Text>
          <Text>Select login method:</Text>
          <Box>
            <Select
              options={[
                {
                  label: (
                    <Text>
                      Claude account with subscription ·{' '}
                      <Text dimColor={true}>
                        Pro, Max, Team, or Enterprise
                      </Text>
                    </Text>
                  ),
                  value: 'claudeai',
                },
                {
                  label: (
                    <Text>
                      Anthropic Console account ·{' '}
                      <Text dimColor={true}>API usage billing</Text>
                    </Text>
                  ),
                  value: 'console',
                },
                {
                  label: (
                    <Text>
                      3rd-party platform ·{' '}
                      <Text dimColor={true}>
                        Amazon Bedrock, Microsoft Foundry, or Vertex AI
                      </Text>
                    </Text>
                  ),
                  value: 'platform',
                },
                {
                  label: (
                    <Text>
                      OpenAI Codex account ·{' '}
                      <Text dimColor={true}>ChatGPT Plus/Pro subscription</Text>
                    </Text>
                  ),
                  value: 'codex',
                },
                {
                  label: (
                    <Text>
                      OpenAI-compatible API key ·{' '}
                      <Text dimColor={true}>
                        DeepSeek, Qwen, Aliyun, or custom gateway
                      </Text>
                    </Text>
                  ),
                  value: 'openai-compatible',
                },
              ]}
              onChange={value => {
                if (value === 'platform') {
                  logEvent('tengu_oauth_platform_selected', {})
                  setOAuthStatus({ state: 'platform_setup' })
                  return
                }

                if (value === 'codex') {
                  logEvent('tengu_oauth_codex_selected', {})
                  setLoginWithCodex(true)
                  setLoginWithClaudeAi(false)
                  setOAuthStatus({ state: 'ready_to_start' })
                  return
                }

                if (value === 'openai-compatible') {
                  logEvent('tengu_oauth_openai_compatible_selected', {})
                  setLoginWithCodex(false)
                  setLoginWithClaudeAi(false)
                  setOAuthStatus({ state: 'openai_provider_select' })
                  return
                }

                setLoginWithCodex(false)
                setOAuthStatus({ state: 'ready_to_start' })
                if (value === 'claudeai') {
                  logEvent('tengu_oauth_claudeai_selected', {})
                  setLoginWithClaudeAi(true)
                } else {
                  logEvent('tengu_oauth_console_selected', {})
                  setLoginWithClaudeAi(false)
                }
              }}
            />
          </Box>
        </Box>
      )

    case 'platform_setup':
      return (
        <Box flexDirection="column" gap={1} marginTop={1}>
          <Text bold={true}>Using 3rd-party platforms</Text>
          <Text>
            Claude Code supports Amazon Bedrock, Microsoft Foundry, and Vertex
            AI. Set the required environment variables, then restart Claude
            Code.
          </Text>
          <Text>
            If you are part of an enterprise organization, contact your
            administrator for setup instructions.
          </Text>
          <Box flexDirection="column" marginTop={1}>
            <Text bold={true}>Documentation:</Text>
            <Text>
              · Amazon Bedrock:{' '}
              <Link url="https://code.claude.com/docs/en/amazon-bedrock">
                https://code.claude.com/docs/en/amazon-bedrock
              </Link>
            </Text>
            <Text>
              · Microsoft Foundry:{' '}
              <Link url="https://code.claude.com/docs/en/microsoft-foundry">
                https://code.claude.com/docs/en/microsoft-foundry
              </Link>
            </Text>
            <Text>
              · Vertex AI:{' '}
              <Link url="https://code.claude.com/docs/en/google-vertex-ai">
                https://code.claude.com/docs/en/google-vertex-ai
              </Link>
            </Text>
          </Box>
          <Box marginTop={1}>
            <Text dimColor={true}>
              Press <Text bold={true}>Enter</Text> to go back to login options.
            </Text>
          </Box>
        </Box>
      )

    case 'openai_provider_select':
      return (
        <Box flexDirection="column" gap={1} marginTop={1}>
          <Text bold={true}>Choose an OpenAI-compatible provider preset</Text>
          <Text dimColor={true}>
            This configures Claude Code to talk to a chat/completions-compatible
            API using your API key.
          </Text>
          <Box>
            <Select
              options={OPENAI_COMPATIBLE_PRESETS.map(option => ({
                label: option.label,
                value: option.value,
              }))}
              onChange={value => {
                setOAuthStatus(
                  createOpenAISetupState(value as OpenAICompatiblePreset),
                )
              }}
              onCancel={() => setOAuthStatus({ state: 'idle' })}
            />
          </Box>
        </Box>
      )

    case 'openai_setup':
      return (
        <Box flexDirection="column" gap={1}>
          <Text bold={true}>{openAICompatiblePrompt?.title}</Text>
          {openAICompatiblePrompt?.subtitle ? (
            <Text dimColor={true}>{openAICompatiblePrompt.subtitle}</Text>
          ) : null}
          <Box>
            <Text>
              {oauthStatus.step === 'base_url'
                ? 'Base URL > '
                : oauthStatus.step === 'api_key'
                  ? 'API key > '
                  : 'Model ID > '}
            </Text>
            <TextInput
              value={openAIInput}
              onChange={setOpenAIInput}
              onSubmit={value => {
                void handleOpenAISetupSubmit(value)
              }}
              focus={true}
              showCursor={true}
              cursorOffset={openAIInputCursorOffset}
              onChangeCursorOffset={setOpenAIInputCursorOffset}
              columns={textInputColumns}
              mask={openAICompatiblePrompt?.mask}
            />
          </Box>
        </Box>
      )

    case 'waiting_for_login':
      return (
        <Box flexDirection="column" gap={1}>
          {forcedMethodMessage ? (
            <Box>
              <Text dimColor={true}>{forcedMethodMessage}</Text>
            </Box>
          ) : null}
          {!showPastePrompt ? (
            <Box>
              <Spinner />
              <Text>Opening browser to sign in…</Text>
            </Box>
          ) : null}
          {showPastePrompt ? (
            <Box>
              <Text>{PASTE_HERE_MSG}</Text>
              <TextInput
                value={pastedCode}
                onChange={setPastedCode}
                onSubmit={value => handleSubmitCode(value, oauthStatus.url)}
                cursorOffset={cursorOffset}
                onChangeCursorOffset={setCursorOffset}
                columns={textInputColumns}
                mask="*"
              />
            </Box>
          ) : null}
        </Box>
      )

    case 'creating_api_key':
      return (
        <Box flexDirection="column" gap={1}>
          <Box>
            <Spinner />
            <Text>Creating API key for Claude Code…</Text>
          </Box>
        </Box>
      )

    case 'saving_openai_config':
      return (
        <Box flexDirection="column" gap={1}>
          <Box>
            <Spinner />
            <Text>Verifying and saving OpenAI-compatible provider settings…</Text>
          </Box>
        </Box>
      )

    case 'about_to_retry':
      return (
        <Box flexDirection="column" gap={1}>
          <Text color="permission">Retrying…</Text>
        </Box>
      )

    case 'success':
      return (
        <Box flexDirection="column">
          {mode === 'setup-token' && oauthStatus.token ? null : (
            <>
              {getOauthAccountInfo()?.emailAddress ? (
                <Text dimColor={true}>
                  Logged in as{' '}
                  <Text>{getOauthAccountInfo()?.emailAddress}</Text>
                </Text>
              ) : null}
              <Text color="success">
                Login successful. Press <Text bold={true}>Enter</Text> to
                continue…
              </Text>
            </>
          )}
        </Box>
      )

    case 'error':
      return (
        <Box flexDirection="column" gap={1}>
          <Text color="error">OAuth error: {oauthStatus.message}</Text>
          {oauthStatus.toRetry ? (
            <Box marginTop={1}>
              <Text color="permission">
                Press <Text bold={true}>Enter</Text> to retry.
              </Text>
            </Box>
          ) : null}
        </Box>
      )

    default:
      return null
  }
}
