// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * AI provider preset templates - default configs for common domestic/international LLM vendors
 *
 * When users create a provider config in the frontend, they only select a vendor and fill in the API key;
 * the rest (apiBase, default model, model list, etc.) is auto-filled from this preset table.
 *
 * All listed providers support the OpenAI-compatible API format (/chat/completions, /embeddings),
 * handled by the unified OpenAICompatibleProvider.
 *
 * Related decisions:
 *   - D-001 cloud API first (multi-provider selection)
 *   - D-002 LLM model selection (common domestic/international models)
 */

/** Provider region */
export type ProviderRegion = 'domestic' | 'international';

/** Provider preset template */
export interface ProviderPreset {
  /** Provider ID (unique identifier, used for DB storage and routing) */
  providerId: string;
  /** Display name */
  name: string;
  /** Region: domestic / international */
  region: ProviderRegion;
  /** API base URL (OpenAI-compatible format) */
  apiBase: string;
  /** Default chat model */
  defaultModel: string;
  /** Available model list */
  models: string[];
  /** Code-generation model (optional, for codegen tasks) */
  codegenModel?: string;
  /** Lightweight model (optional, for health checks and low-cost scenarios) */
  liteModel?: string;
  /** Embedding model (optional, for RAG vectorization) */
  embeddingModel?: string;
  /** Embedding dimension (optional) */
  embeddingDim?: number;
  /** Request timeout (ms) */
  timeout: number;
  /** Max retry count */
  maxRetries: number;
  /** API key application URL */
  apiKeyUrl: string;
  /** Whether embedding is supported */
  supportsEmbedding: boolean;
  /** Vendor description */
  description: string;
}

/**
 * Preset provider list
 *
 * Domestic providers (5) + international providers (4) + custom (1)
 */
export const PROVIDER_PRESETS: ProviderPreset[] = [
  // ==================== Domestic providers ====================
  {
    providerId: 'deepseek',
    name: 'DeepSeek',
    region: 'domestic',
    apiBase: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    models: ['deepseek-chat', 'deepseek-coder', 'deepseek-reasoner'],
    codegenModel: 'deepseek-coder',
    liteModel: 'deepseek-chat',
    timeout: 60000,
    maxRetries: 3,
    apiKeyUrl: 'https://platform.deepseek.com/api_keys',
    supportsEmbedding: false,
    description: '代码生成能力极强、推理优秀、性价比高',
  },
  {
    providerId: 'zhipu',
    name: '智谱 GLM',
    region: 'domestic',
    apiBase: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-4',
    models: ['glm-4', 'glm-4-flash', 'glm-4-air', 'glm-4-plus', 'embedding-3'],
    liteModel: 'glm-4-flash',
    embeddingModel: 'embedding-3',
    embeddingDim: 1024,
    timeout: 60000,
    maxRetries: 3,
    apiKeyUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
    supportsEmbedding: true,
    description: '中文理解最佳、多模态支持、生态完善',
  },
  {
    providerId: 'qwen',
    name: '通义千问 (Qwen)',
    region: 'domestic',
    apiBase: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-plus',
    models: ['qwen-max', 'qwen-plus', 'qwen-turbo', 'qwen-long', 'text-embedding-v3'],
    codegenModel: 'qwen-plus',
    liteModel: 'qwen-turbo',
    embeddingModel: 'text-embedding-v3',
    embeddingDim: 1024,
    timeout: 60000,
    maxRetries: 3,
    apiKeyUrl: 'https://dashscope.console.aliyun.com/apiKey',
    supportsEmbedding: true,
    description: '阿里云出品，多模型规模、长文本处理能力强',
  },
  {
    providerId: 'moonshot',
    name: 'Kimi (月之暗面)',
    region: 'domestic',
    apiBase: 'https://api.moonshot.cn/v1',
    defaultModel: 'moonshot-v1-8k',
    models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
    liteModel: 'moonshot-v1-8k',
    timeout: 60000,
    maxRetries: 3,
    apiKeyUrl: 'https://platform.moonshot.cn/console/api-keys',
    supportsEmbedding: false,
    description: '超长上下文支持（最高 128K），适合长文档处理',
  },
  {
    providerId: 'ernie',
    name: '文心一言 (ERNIE)',
    region: 'domestic',
    apiBase: 'https://qianfan.baidubce.com/v2',
    defaultModel: 'ernie-4.0-8k-latest',
    models: ['ernie-4.0-8k-latest', 'ernie-3.5-8k', 'ernie-speed-128k', 'ernie-lite-8k'],
    codegenModel: 'ernie-4.0-8k-latest',
    liteModel: 'ernie-lite-8k',
    embeddingModel: 'bge-large-zh',
    embeddingDim: 1024,
    timeout: 60000,
    maxRetries: 3,
    apiKeyUrl: 'https://console.bce.baidu.com/qianfan/ais/console/applicationConsole/application',
    supportsEmbedding: true,
    description: '百度出品，中文理解强、生态完善',
  },

  // ==================== International providers ====================
  {
    providerId: 'openai',
    name: 'OpenAI',
    region: 'international',
    apiBase: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o',
    models: [
      'gpt-4o',
      'gpt-4o-mini',
      'gpt-4-turbo',
      'o1-preview',
      'o1-mini',
      'text-embedding-3-small',
      'text-embedding-3-large',
    ],
    codegenModel: 'gpt-4o',
    liteModel: 'gpt-4o-mini',
    embeddingModel: 'text-embedding-3-small',
    embeddingDim: 1536,
    timeout: 60000,
    maxRetries: 3,
    apiKeyUrl: 'https://platform.openai.com/api-keys',
    supportsEmbedding: true,
    description: '业界标杆，多模态、代码生成、推理能力全面领先',
  },
  {
    providerId: 'claude',
    name: 'Anthropic Claude',
    region: 'international',
    apiBase: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-3-5-sonnet-20241022',
    models: ['claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022', 'claude-3-opus-20240229'],
    codegenModel: 'claude-3-5-sonnet-20241022',
    liteModel: 'claude-3-5-haiku-20241022',
    timeout: 60000,
    maxRetries: 3,
    apiKeyUrl: 'https://console.anthropic.com/settings/keys',
    supportsEmbedding: false,
    description: '超长上下文、推理与代码能力出色、安全性强',
  },
  {
    providerId: 'gemini',
    name: 'Google Gemini',
    region: 'international',
    apiBase: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-1.5-pro',
    models: ['gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-1.5-flash-8b', 'text-embedding-004'],
    codegenModel: 'gemini-1.5-pro',
    liteModel: 'gemini-1.5-flash',
    embeddingModel: 'text-embedding-004',
    embeddingDim: 768,
    timeout: 60000,
    maxRetries: 3,
    apiKeyUrl: 'https://aistudio.google.com/apikey',
    supportsEmbedding: true,
    description: 'Google 出品，多模态原生支持、超长上下文（最高 2M tokens）',
  },
  {
    providerId: 'mistral',
    name: 'Mistral AI',
    region: 'international',
    apiBase: 'https://api.mistral.ai/v1',
    defaultModel: 'mistral-large-latest',
    models: ['mistral-large-latest', 'mistral-small-latest', 'codestral-latest', 'mistral-embed'],
    codegenModel: 'codestral-latest',
    liteModel: 'mistral-small-latest',
    embeddingModel: 'mistral-embed',
    embeddingDim: 1024,
    timeout: 60000,
    maxRetries: 3,
    apiKeyUrl: 'https://console.mistral.ai/api-keys/',
    supportsEmbedding: true,
    description: '欧洲领先 AI 公司，开源生态活跃、代码生成强',
  },

  // ==================== Custom ====================
  {
    providerId: 'custom',
    name: '自定义供应商',
    region: 'domestic',
    apiBase: '',
    defaultModel: '',
    models: [],
    timeout: 60000,
    maxRetries: 3,
    apiKeyUrl: '',
    supportsEmbedding: false,
    description: '手动配置任意 OpenAI 兼容 API 端点',
  },
];

/** Find preset template by providerId */
export function findPreset(providerId: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((p) => p.providerId === providerId);
}

/** Get all preset templates (grouped by region) */
export function getPresetsByRegion(): {
  domestic: ProviderPreset[];
  international: ProviderPreset[];
} {
  return {
    domestic: PROVIDER_PRESETS.filter((p) => p.region === 'domestic'),
    international: PROVIDER_PRESETS.filter((p) => p.region === 'international'),
  };
}
