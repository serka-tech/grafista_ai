/**
 * Grafista AI Studio — Workflow Catalog (Phase 2 Step 6)
 *
 * Loads and cross-validates the whole workflow surface in one place:
 *   1. every workflows/*.json definition parses + validates (definition-loader),
 *   2. every referenced skill id (skills_used, step.skill, step.ai_provider_routing)
 *      resolves to a loadable, well-formed .agents/skills/<id>/SKILL.md,
 *   3. every step-referenced skill is also listed in that workflow's skills_used,
 *   4. every (workflow_id, step_id) has an explicit entry in the step-binding
 *      registry — no silent no-op steps,
 *   5. every registered binding key matches a real workflow step (catches typos).
 *
 * All problems are aggregated into ONE error so a broken deploy shows the
 * full list at once. index.ts calls getWorkflowCatalog() before listen and
 * exits with a clear [Workflow Catalog Error] message on failure (fail fast);
 * routes call getWorkflowCatalog() too — if it throws there, the central
 * errorHandler renders a 500 with the same clear message.
 */

import type { WorkflowDefinition } from '@grafista/schemas';
import { loadWorkflowDefinitions } from './definition-loader.js';
import { loadSkills, type LoadedSkill } from './skill-loader.js';
import { STEP_BINDINGS, type StepBinding } from './step-bindings.js';

export interface WorkflowCatalog {
  definitions: WorkflowDefinition[];
  skills: Map<string, LoadedSkill>;
  bindings: Map<string, StepBinding>;
}

export function loadWorkflowCatalog(options?: { workflowsDir?: string; skillsDir?: string }): WorkflowCatalog {
  const definitions = loadWorkflowDefinitions(options?.workflowsDir);
  const errors: string[] = [];
  const referencedSkillIds = new Set<string>();
  const knownStepKeys = new Set<string>();

  for (const def of definitions) {
    for (const skillId of def.skills_used) {
      referencedSkillIds.add(skillId);
    }
    for (const step of def.steps) {
      const key = `${def.workflow_id}/${step.step_id}`;
      knownStepKeys.add(key);

      for (const ref of [step.skill, step.ai_provider_routing]) {
        if (!ref) continue;
        referencedSkillIds.add(ref);
        if (!def.skills_used.includes(ref)) {
          errors.push(`Workflow ${def.workflow_id} step ${step.step_id} references skill '${ref}' that is not listed in skills_used`);
        }
      }

      if (!STEP_BINDINGS[key]) {
        errors.push(`No step binding registered for ${key}`);
      }
    }
  }

  for (const key of Object.keys(STEP_BINDINGS)) {
    if (!knownStepKeys.has(key)) {
      errors.push(`Step binding '${key}' does not match any workflow step`);
    }
  }

  let skills = new Map<string, LoadedSkill>();
  try {
    skills = loadSkills([...referencedSkillIds], options?.skillsDir);
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }

  if (errors.length > 0) {
    throw new Error(`Workflow catalog validation failed:\n- ${errors.join('\n- ')}`);
  }

  return { definitions, skills, bindings: new Map(Object.entries(STEP_BINDINGS)) };
}

let cachedCatalog: WorkflowCatalog | undefined;

/** Lazy singleton — loaded once per process (definitions/skills are static files). */
export function getWorkflowCatalog(): WorkflowCatalog {
  if (!cachedCatalog) {
    cachedCatalog = loadWorkflowCatalog();
  }
  return cachedCatalog;
}
