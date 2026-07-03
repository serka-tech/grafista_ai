/**
 * Grafista AI Studio — Workflow Definition Loader (Phase 2 Step 6)
 *
 * Reads and validates the ten JSON workflow definitions in workflows/*.json
 * against WorkflowDefinitionSchema (packages/schemas/src/workflow.ts). Any
 * unreadable/invalid file fails loudly with the filename in the message —
 * the server refuses to start on a broken definition (see catalog.ts /
 * index.ts) rather than serving a silently wrong pipeline.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { WorkflowDefinitionSchema, type WorkflowDefinition } from '@grafista/schemas';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const WORKFLOWS_DIR = path.resolve(__dirname, '../../../../workflows');

/** Canonical pipeline presentation order (matches the dashboard's pipeline view). */
export const PIPELINE_ORDER = [
  'client-onboarding',
  'style-library-ingestion',
  'content-generation',
  'design-brief',
  'layout-generation',
  'visual-generation',
  'photoshop-production',
  'creative-qa',
  'revision-learning',
  'monthly-content-calendar',
] as const;

function pipelineIndex(workflowId: string): number {
  const index = (PIPELINE_ORDER as readonly string[]).indexOf(workflowId);
  return index === -1 ? PIPELINE_ORDER.length : index;
}

/** Loads every workflows/*.json definition, validated and sorted in pipeline order. */
export function loadWorkflowDefinitions(dir: string = WORKFLOWS_DIR): WorkflowDefinition[] {
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort();

  const definitions: WorkflowDefinition[] = [];
  for (const file of files) {
    const rawText = fs.readFileSync(path.join(dir, file), 'utf8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawText);
    } catch (err) {
      throw new Error(`Workflow definition ${file} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
    }

    const validated = WorkflowDefinitionSchema.safeParse(parsed);
    if (!validated.success) {
      const issues = validated.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; ');
      throw new Error(`Workflow definition ${file} failed validation: ${issues}`);
    }
    definitions.push(validated.data);
  }

  return definitions.sort((a, b) => pipelineIndex(a.workflow_id) - pipelineIndex(b.workflow_id));
}
