/**
 * Grafista AI Studio — Model Router Types
 */

export type AIProvider = 'openai' | 'gemini' | 'claude' | 'kie-ai' | 'higgsfield' | 'fake';

export type AITaskType =
  | 'brand_intake'
  | 'style_analysis'
  | 'design_dna_synthesis'
  | 'tone_extraction'
  | 'content_ideation'
  | 'caption_generation'
  | 'design_brief'
  | 'layout_generation'
  | 'creative_qa'
  | 'revision_learning'
  | 'image_generation'
  | 'video_generation';

export type AICapability = 'text' | 'vision' | 'image_generation' | 'video_generation' | 'embedding';

export interface ProviderConfig {
  name: AIProvider;
  displayName: string;
  apiKeyEnv: string;
  baseUrl?: string;
  capabilities: AICapability[];
  models: ModelConfig[];
  isEnabled: boolean;
  maxRetries: number;
  timeoutMs: number;
  costPerMToken?: number;
}

export interface ModelConfig {
  id: string;
  name: string;
  capabilities: AICapability[];
  maxTokens: number;
  costPer1kInput?: number;
  costPer1kOutput?: number;
}

export interface AIRequest {
  taskType: AITaskType;
  provider?: AIProvider;
  model?: string;
  systemPrompt: string;
  userPrompt: string;
  images?: string[];
  outputFormat: 'json' | 'text' | 'markdown';
  maxTokens?: number;
  temperature?: number;
  metadata?: Record<string, unknown>;
}

export interface AIResponse {
  success: boolean;
  provider: AIProvider;
  model: string;
  content: string;
  parsedContent?: unknown;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedCost?: number;
  };
  latencyMs: number;
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface ProviderAdapter {
  name: AIProvider;
  /**
   * Capabilities this adapter's complete() ACTUALLY implements today — not what
   * the provider's platform could theoretically do. The router only selects an
   * adapter for a task when it covers the task's requiredCapabilities.
   */
  capabilities: AICapability[];
  isAvailable(): boolean;
  complete(request: AIRequest): Promise<AIResponse>;
}

export interface TaskRouting {
  taskType: AITaskType;
  primaryProvider: AIProvider;
  fallbackProviders: AIProvider[];
  requiredCapabilities: AICapability[];
}
