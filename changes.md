# OpenAI Provider Support: Codex OAuth + OpenAI-Compatible API Mode

## Summary
This update keeps the existing Codex OAuth integration, and adds a second OpenAI-path that works with **OpenAI-compatible chat/completions APIs** such as **DeepSeek**, **Qwen / DashScope**, **Aliyun-compatible gateways**, and other custom OpenAI-style endpoints. The new mode is wired into the REPL **`/login`** flow so it can be configured interactively instead of only through manual environment edits.

## Key Changes

### 1. General OpenAI-Compatible API Adapter
- Added **`src/services/api/openai-compatible-fetch-adapter.ts`**.
- Translates Anthropic Messages API requests into **OpenAI-compatible `chat/completions`** requests.
- Supports:
  - standard text prompts
  - Anthropic-style system prompts
  - tool calls / tool results
  - base64 image inputs
  - streaming responses mapped back into Anthropic-style SSE events
- This makes the existing Anthropic SDK client usable against vendors that expose OpenAI-style APIs, instead of only the Codex-specific Responses API.

### 2. OpenAI Provider Split: Codex vs OpenAI-Compatible
- Preserved the existing **Codex OAuth** behavior.
- Extended provider/auth routing so the `openai` provider now has two distinct modes:
  - **Codex OAuth mode**: selected when Codex tokens are present
  - **OpenAI-compatible API-key mode**: selected when `OPENAI_API_KEY` is configured
- Added persisted config helpers in **`src/utils/auth.ts`** for:
  - `OPENAI_API_KEY`
  - `OPENAI_BASE_URL`
  - `OPENAI_MODEL`
- Added explicit provider activation helpers so switching between Anthropic, Codex, and OpenAI-compatible mode is consistent and immediate after login.

### 3. REPL `/login` Support for OpenAI-Compatible Providers
- Extended **`src/components/ConsoleOAuthFlow.tsx`** with a new login option:
  - **OpenAI-compatible API key**
- Added provider presets for:
  - **DeepSeek**
  - **Qwen / DashScope**
  - **OpenAI**
  - **Custom endpoint**
- The login flow now walks the user through:
  1. choosing a preset
  2. entering or confirming the base URL
  3. entering the API key
  4. entering the default model ID
- Before saving, Claude Code now sends a minimal validation request to the configured OpenAI-compatible endpoint so invalid API keys, bad base URLs, and unsupported model IDs fail immediately in `/login`.
- After validation succeeds, the configuration is written to user config and applied to the current REPL session.
- `/logout` now also clears OpenAI-compatible credentials and Codex OAuth tokens instead of only clearing Anthropic auth state.
- Removed the startup Anthropic connectivity preflight so the CLI no longer blocks launch with `Unable to connect to Anthropic services` before you even enter the REPL.

### 4. Model Picker / Billing / Validation Integration
- Updated model selection logic so OpenAI-compatible mode can use the configured model as the active default model.
- Reused the existing `settings.model` path for the OpenAI-compatible default model instead of persisting a second dedicated model config key.
- Removed fallback reads from legacy `OPENAI_MODEL`; the active OpenAI-compatible model now comes from the single `settings.model` source of truth.
- Updated model picker logic to surface the configured OpenAI-compatible model in `/model`.
- Updated model validation so the configured OpenAI-compatible model is accepted without Anthropic-side validation.
- Updated header/billing UI to distinguish:
  - **Codex API Billing**
  - **OpenAI-compatible API Billing**

### 5. Existing Codex Support Preserved
- The existing Codex adapter and OAuth flow remain intact.
- `/login` still supports:
  - Claude subscription login
  - Anthropic Console login
  - 3rd-party cloud platforms
  - Codex OAuth login
- The new OpenAI-compatible flow is additive and does not replace the original Codex path.

### 6. DeepSeek Model Preset Refresh
- Updated the DeepSeek preset in the OpenAI-compatible login flow to default to **`deepseek-v4-flash`** instead of the older `deepseek-chat`.
- Updated model entry examples to reflect the latest DeepSeek lineup:
  - `deepseek-v4-flash`
  - `deepseek-v4-pro`
  - `deepseek-chat` *(deprecated upstream on 2026/07/24)*
  - `deepseek-reasoner` *(deprecated upstream on 2026/07/24)*
