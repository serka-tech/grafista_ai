/**
 * Grafista AI Studio — Prompt Builder
 *
 * Template-based prompt construction engine.
 * Combines brand context, Design DNA, and task-specific templates
 * into structured prompts for AI providers.
 */

export interface PromptVariable {
  key: string;
  value: string;
  required?: boolean;
}

export interface PromptTemplate {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  userPromptTemplate: string;
  requiredVariables: string[];
  optionalVariables?: string[];
  outputFormat?: 'json' | 'text' | 'markdown';
  expectedSchema?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface BuiltPrompt {
  system: string;
  user: string;
  metadata: {
    templateId: string;
    variables: Record<string, string>;
    outputFormat: 'json' | 'text' | 'markdown';
    maxTokens?: number;
    temperature?: number;
  };
}

export class PromptBuilder {
  private variables: Map<string, string> = new Map();

  constructor(private template: PromptTemplate) {}

  setVariable(key: string, value: string): this {
    this.variables.set(key, value);
    return this;
  }

  setVariables(vars: Record<string, string>): this {
    for (const [key, value] of Object.entries(vars)) {
      this.variables.set(key, value);
    }
    return this;
  }

  private interpolate(text: string): string {
    let result = text;
    for (const [key, value] of this.variables) {
      const placeholder = `{{${key}}}`;
      result = result.replaceAll(placeholder, value);
    }
    return result;
  }

  validate(): { valid: boolean; missingVars: string[] } {
    const missing = this.template.requiredVariables.filter(
      (v) => !this.variables.has(v)
    );
    return { valid: missing.length === 0, missingVars: missing };
  }

  build(): BuiltPrompt {
    const validation = this.validate();
    if (!validation.valid) {
      throw new Error(
        `Missing required variables: ${validation.missingVars.join(', ')}`
      );
    }

    return {
      system: this.interpolate(this.template.systemPrompt),
      user: this.interpolate(this.template.userPromptTemplate),
      metadata: {
        templateId: this.template.id,
        variables: Object.fromEntries(this.variables),
        outputFormat: this.template.outputFormat ?? 'json',
        maxTokens: this.template.maxTokens,
        temperature: this.template.temperature,
      },
    };
  }
}

export function createPromptBuilder(template: PromptTemplate): PromptBuilder {
  return new PromptBuilder(template);
}
