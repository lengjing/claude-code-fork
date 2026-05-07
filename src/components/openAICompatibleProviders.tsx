import React from 'react'
import { Text } from '../ink.js'

export type OpenAICompatiblePreset =
  | 'openai'
  | 'deepseek'
  | 'qwen'
  | 'minimax'
  | 'zhipu'
  | 'moonshot'
  | 'siliconflow'
  | 'custom'

export type ProviderPreset = {
  value: OpenAICompatiblePreset
  label: React.ReactNode
  baseUrl: string
  defaultModel: string
  models: Array<{ value: string; label: React.ReactNode }>
}

export const OPENAI_COMPATIBLE_PRESETS: ProviderPreset[] = [
  {
    value: 'deepseek',
    label: (
      <Text>
        DeepSeek · <Text dimColor={true}>api.deepseek.com</Text>
      </Text>
    ),
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-v4-flash',
    models: [
      {
        value: 'deepseek-v4-flash',
        label: (
          <Text>
            deepseek-v4-flash · <Text dimColor={true}>DeepSeek V4 Flash (recommended)</Text>
          </Text>
        ),
      },
      {
        value: 'deepseek-v4-pro',
        label: (
          <Text>
            deepseek-v4-pro · <Text dimColor={true}>DeepSeek V4 Pro</Text>
          </Text>
        ),
      },
      {
        value: 'deepseek-chat',
        label: (
          <Text>
            deepseek-chat · <Text dimColor={true}>DeepSeek V3 (deprecated 2026/07/24)</Text>
          </Text>
        ),
      },
      {
        value: 'deepseek-reasoner',
        label: (
          <Text>
            deepseek-reasoner · <Text dimColor={true}>DeepSeek R1 (deprecated 2026/07/24)</Text>
          </Text>
        ),
      },
    ],
  },
  {
    value: 'qwen',
    label: (
      <Text>
        通义千问 (Qwen) · <Text dimColor={true}>Alibaba DashScope</Text>
      </Text>
    ),
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-plus',
    models: [
      {
        value: 'qwen-plus',
        label: (
          <Text>
            qwen-plus · <Text dimColor={true}>balanced speed & quality (recommended)</Text>
          </Text>
        ),
      },
      {
        value: 'qwen-max',
        label: (
          <Text>
            qwen-max · <Text dimColor={true}>most capable</Text>
          </Text>
        ),
      },
      {
        value: 'qwen-turbo',
        label: (
          <Text>
            qwen-turbo · <Text dimColor={true}>fast & cost-effective</Text>
          </Text>
        ),
      },
      {
        value: 'qwen-long',
        label: (
          <Text>
            qwen-long · <Text dimColor={true}>long context (1M tokens)</Text>
          </Text>
        ),
      },
    ],
  },
  {
    value: 'zhipu',
    label: (
      <Text>
        智谱 (Zhipu AI) · <Text dimColor={true}>open.bigmodel.cn</Text>
      </Text>
    ),
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-4-plus',
    models: [
      {
        value: 'glm-4-plus',
        label: (
          <Text>
            glm-4-plus · <Text dimColor={true}>most capable (recommended)</Text>
          </Text>
        ),
      },
      {
        value: 'glm-4-air',
        label: (
          <Text>
            glm-4-air · <Text dimColor={true}>efficient & cost-effective</Text>
          </Text>
        ),
      },
      {
        value: 'glm-4-flash',
        label: (
          <Text>
            glm-4-flash · <Text dimColor={true}>fast & free tier available</Text>
          </Text>
        ),
      },
    ],
  },
  {
    value: 'moonshot',
    label: (
      <Text>
        月之暗面 (Moonshot / Kimi) · <Text dimColor={true}>api.moonshot.cn</Text>
      </Text>
    ),
    baseUrl: 'https://api.moonshot.cn/v1',
    defaultModel: 'moonshot-v1-8k',
    models: [
      {
        value: 'moonshot-v1-8k',
        label: (
          <Text>
            moonshot-v1-8k · <Text dimColor={true}>8k context (recommended)</Text>
          </Text>
        ),
      },
      {
        value: 'moonshot-v1-32k',
        label: (
          <Text>
            moonshot-v1-32k · <Text dimColor={true}>32k context</Text>
          </Text>
        ),
      },
      {
        value: 'moonshot-v1-128k',
        label: (
          <Text>
            moonshot-v1-128k · <Text dimColor={true}>128k context</Text>
          </Text>
        ),
      },
    ],
  },
  {
    value: 'minimax',
    label: (
      <Text>
        MiniMax · <Text dimColor={true}>api.minimaxi.chat</Text>
      </Text>
    ),
    baseUrl: 'https://api.minimaxi.chat/v1',
    defaultModel: 'MiniMax-Text-01',
    models: [
      {
        value: 'MiniMax-Text-01',
        label: (
          <Text>
            MiniMax-Text-01 · <Text dimColor={true}>most capable (recommended)</Text>
          </Text>
        ),
      },
      {
        value: 'abab6.5s-chat',
        label: (
          <Text>
            abab6.5s-chat · <Text dimColor={true}>fast & cost-effective</Text>
          </Text>
        ),
      },
    ],
  },
  {
    value: 'siliconflow',
    label: (
      <Text>
        SiliconFlow · <Text dimColor={true}>api.siliconflow.cn</Text>
      </Text>
    ),
    baseUrl: 'https://api.siliconflow.cn/v1',
    defaultModel: 'Qwen/Qwen2.5-72B-Instruct',
    models: [
      {
        value: 'Qwen/Qwen2.5-72B-Instruct',
        label: (
          <Text>
            Qwen2.5-72B-Instruct · <Text dimColor={true}>Qwen flagship (recommended)</Text>
          </Text>
        ),
      },
      {
        value: 'deepseek-ai/DeepSeek-V3',
        label: (
          <Text>
            DeepSeek-V3 · <Text dimColor={true}>DeepSeek via SiliconFlow</Text>
          </Text>
        ),
      },
      {
        value: 'deepseek-ai/DeepSeek-R1',
        label: (
          <Text>
            DeepSeek-R1 · <Text dimColor={true}>reasoning model via SiliconFlow</Text>
          </Text>
        ),
      },
      {
        value: 'Pro/Qwen/Qwen2.5-7B-Instruct',
        label: (
          <Text>
            Qwen2.5-7B-Instruct · <Text dimColor={true}>lightweight, free tier</Text>
          </Text>
        ),
      },
    ],
  },
  {
    value: 'openai',
    label: (
      <Text>
        OpenAI · <Text dimColor={true}>Official OpenAI API</Text>
      </Text>
    ),
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4.1',
    models: [
      {
        value: 'gpt-4.1',
        label: (
          <Text>
            gpt-4.1 · <Text dimColor={true}>latest GPT-4.1 (recommended)</Text>
          </Text>
        ),
      },
      {
        value: 'gpt-4.1-mini',
        label: (
          <Text>
            gpt-4.1-mini · <Text dimColor={true}>fast & cost-effective</Text>
          </Text>
        ),
      },
      {
        value: 'gpt-4o',
        label: (
          <Text>
            gpt-4o · <Text dimColor={true}>multimodal</Text>
          </Text>
        ),
      },
      {
        value: 'o3-mini',
        label: (
          <Text>
            o3-mini · <Text dimColor={true}>reasoning model</Text>
          </Text>
        ),
      },
    ],
  },
  {
    value: 'custom',
    label: (
      <Text>
        Custom endpoint · <Text dimColor={true}>Any OpenAI-compatible gateway</Text>
      </Text>
    ),
    baseUrl: '',
    defaultModel: '',
    models: [],
  },
]
