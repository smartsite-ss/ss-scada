// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * AI Provider configuration API — backed by /api/v1/ai/providers
 *
 * Provider configuration has migrated to database management, supporting:
 *   - Preset template query (GET /providers/presets)
 *   - Quick creation (POST /providers/from-preset, only needs an API key)
 *   - Full CRUD (POST/PUT/DELETE /providers)
 */

import client from '../client';
import type { ApiResponse } from '../types/api';

/** Provider region */
export type ProviderRegion = 'domestic' | 'international';

/** Preset provider template (fetched from the backend, includes vendor default configuration) */
export interface ProviderPreset {
  providerId: string;
  name: string;
  region: ProviderRegion;
  apiBase: string;
  defaultModel: string;
  models: string[];
  codegenModel?: string;
  liteModel?: string;
  embeddingModel?: string;
  embeddingDim?: number;
  timeout: number;
  maxRetries: number;
  apiKeyUrl: string;
  supportsEmbedding: boolean;
  description: string;
}

/** AI provider configuration view */
export interface AiProviderConfig {
  id: string;
  providerId: string;
  name: string;
  apiKey: string;
  apiBase: string;
  defaultModel: string;
  models: string[];
  enabled: boolean;
  sortOrder: number;
  config: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAiProviderPayload {
  providerId: string;
  name: string;
  apiKey: string;
  apiBase: string;
  defaultModel: string;
  models?: string[];
  enabled?: boolean;
  sortOrder?: number;
  config?: Record<string, any>;
}

export type UpdateAiProviderPayload = Partial<CreateAiProviderPayload>;

/** Quick creation payload (only needs providerId and apiKey) */
export interface CreateFromPresetPayload {
  providerId: string;
  apiKey: string;
}

/** Provider connection test result */
export interface AiProviderTestResult {
  success: boolean;
  latencyMs?: number;
  error?: string;
  checkedAt: number;
}

export const aiProviderApi = {
  /** Get all provider configurations */
  async list(): Promise<AiProviderConfig[]> {
    const res = await client.get<ApiResponse<{ providers: AiProviderConfig[] }>>('/ai/providers');
    return res.data.data?.providers ?? [];
  },

  /** Get all preset provider templates (vendor default configuration) */
  async presets(): Promise<ProviderPreset[]> {
    const res = await client.get<ApiResponse<{ presets: ProviderPreset[] }>>('/ai/providers/presets');
    return res.data.data?.presets ?? [];
  },

  /** Quickly create a provider from a preset template (only needs an API key) */
  async createFromPreset(payload: CreateFromPresetPayload): Promise<AiProviderConfig> {
    const res = await client.post<ApiResponse<AiProviderConfig>>('/ai/providers/from-preset', payload);
    return res.data.data;
  },

  /** Create a provider configuration (full fields) */
  async create(payload: CreateAiProviderPayload): Promise<AiProviderConfig> {
    const res = await client.post<ApiResponse<AiProviderConfig>>('/ai/providers', payload);
    return res.data.data;
  },

  /** Update a provider configuration */
  async update(id: string, payload: UpdateAiProviderPayload): Promise<AiProviderConfig> {
    const res = await client.put<ApiResponse<AiProviderConfig>>(`/ai/providers/${id}`, payload);
    return res.data.data;
  },

  /** Delete a provider configuration */
  async remove(id: string): Promise<void> {
    await client.delete(`/ai/providers/${id}`);
  },

  /** Toggle enable/disable */
  async toggle(id: string, enabled: boolean): Promise<AiProviderConfig> {
    const res = await client.put<ApiResponse<AiProviderConfig>>(
      `/ai/providers/${id}/toggle`,
      { enabled },
    );
    return res.data.data;
  },

  /** Update the API key (convenience method, passes only apiKey) */
  async updateApiKey(id: string, apiKey: string): Promise<AiProviderConfig> {
    const res = await client.put<ApiResponse<AiProviderConfig>>(`/ai/providers/${id}`, { apiKey });
    return res.data.data;
  },

  /** Test the provider connection (issues a minimal request with the saved configuration, returns the connection result and latency) */
  async test(id: string): Promise<AiProviderTestResult> {
    const res = await client.post<ApiResponse<AiProviderTestResult>>(`/ai/providers/${id}/test`);
    return res.data.data;
  },
};
