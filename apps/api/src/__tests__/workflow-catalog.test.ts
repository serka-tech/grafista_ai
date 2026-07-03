import { describe, it, expect, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { loadWorkflowDefinitions, PIPELINE_ORDER, WORKFLOWS_DIR } from '../workflows/definition-loader.js';
import { loadWorkflowCatalog, getWorkflowCatalog } from '../workflows/catalog.js';
import { loadSkill, loadSkills, buildSkillStepContext } from '../workflows/skill-loader.js';

/**
 * Loader/validation unit tests for the workflow catalog (Phase 2 Step 6):
 * definition-loader.ts, skill-loader.ts, and catalog.ts cross-validation.
 * All broken-input fixtures live in throwaway fs.mkdtempSync directories and
 * are fed through the loaders' explicit `dir` override parameters — the real
 * workflows/ and .agents/skills/ trees are never touched. The HTTP/engine
 * behavior of the same catalog is covered in workflows.test.ts.
 */

const tmpDirs: string[] = [];

function makeTmpDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});

/** Copies the ten real workflow JSONs into a temp dir so one can be broken in isolation. */
function copyRealWorkflows(): string {
  const dir = makeTmpDir('grafista-workflows-');
  for (const file of fs.readdirSync(WORKFLOWS_DIR).filter((f) => f.endsWith('.json'))) {
    fs.copyFileSync(path.join(WORKFLOWS_DIR, file), path.join(dir, file));
  }
  return dir;
}

function rewriteDefinition(dir: string, file: string, mutate: (def: Record<string, unknown>) => void): void {
  const filePath = path.join(dir, file);
  const def = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>;
  mutate(def);
  fs.writeFileSync(filePath, JSON.stringify(def, null, 2));
}

/** Minimal schema-valid definition for fixtures that need full control over steps. */
function minimalDefinition(steps: Array<Record<string, unknown>>): Record<string, unknown> {
  return {
    workflow_id: 'fixture-workflow',
    name: 'Fixture Workflow',
    purpose: 'Loader validation fixture',
    trigger: 'test',
    required_inputs: { client_id: { type: 'string', required: true } },
    steps,
    skills_used: [],
    approval_required: false,
    outputs: {},
    failure_cases: [],
    next_workflow: null,
  };
}

function minimalStep(stepId: string, order: number): Record<string, unknown> {
  return {
    step_id: stepId,
    order,
    action: 'Fixture step',
    type: 'system',
    inputs: [],
    outputs: [],
    skill: null,
    approval_required: false,
  };
}

/** A SKILL.md that satisfies every loader requirement — fixtures below break one rule each. */
function validSkillMd(name: string): string {
  return [
    '---',
    `name: ${name}`,
    'description: Test skill fixture',
    '---',
    '',
    `# ${name}`,
    '',
    '## When to Use',
    '- fixture',
    '',
    '## Input Expectations',
    '- fixture',
    '',
    '## Output Expectations',
    '- fixture',
    '',
    '## Checklist',
    '- [ ] fixture',
    '',
    '## Failure Conditions',
    '- fixture',
    '',
  ].join('\n');
}

function writeSkill(dir: string, id: string, content: string): void {
  fs.mkdirSync(path.join(dir, id), { recursive: true });
  fs.writeFileSync(path.join(dir, id, 'SKILL.md'), content);
}

describe('1. Real workflow definitions load and cross-validate', () => {
  it('loads exactly the ten definitions, sorted in pipeline order', () => {
    const definitions = loadWorkflowDefinitions();
    expect(definitions.length).toBe(10);
    expect(definitions.map((d) => d.workflow_id)).toEqual([...PIPELINE_ORDER]);
  });

  it('builds a valid catalog: every step bound, bindings bijective, every referenced skill resolved', () => {
    const catalog = loadWorkflowCatalog();
    expect(catalog.definitions.length).toBe(10);

    let totalSteps = 0;
    for (const def of catalog.definitions) {
      for (const step of def.steps) {
        totalSteps += 1;
        expect(catalog.bindings.get(`${def.workflow_id}/${step.step_id}`)).toBeDefined();
      }
      for (const skillId of def.skills_used) {
        expect(catalog.skills.get(skillId)).toBeDefined();
      }
    }
    // Bijective: one binding per step, no orphan binding keys.
    expect(catalog.bindings.size).toBe(totalSteps);
    expect(totalSteps).toBe(79);
  });

  it('getWorkflowCatalog returns a cached singleton', () => {
    expect(getWorkflowCatalog()).toBe(getWorkflowCatalog());
  });

  it('loads a real skill with frontmatter and all five required sections', () => {
    const skill = loadSkill('style-analysis');
    expect(skill.id).toBe('style-analysis');
    expect(skill.name).toBe('style-analysis');
    expect(skill.description.length).toBeGreaterThan(0);
    expect(skill.whenToUse.length).toBeGreaterThan(0);
    expect(skill.inputExpectations.length).toBeGreaterThan(0);
    expect(skill.outputExpectations.length).toBeGreaterThan(0);
    expect(skill.checklist.length).toBeGreaterThan(0);
    expect(skill.failureConditions.length).toBeGreaterThan(0);
    // Regression guard: extractSection must capture the WHOLE section body, not just its
    // first line — style-analysis's real 'When to Use' and 'Checklist' sections both carry
    // several bullets.
    expect(skill.whenToUse.split('\n').filter((l) => l.trim().startsWith('-')).length).toBeGreaterThan(1);
    expect(skill.checklist.split('\n').filter((l) => l.trim().startsWith('- [')).length).toBeGreaterThan(1);

    const context = buildSkillStepContext(skill);
    expect(context).toEqual({
      skillId: 'style-analysis',
      description: skill.description,
      whenToUse: skill.whenToUse,
      checklist: skill.checklist,
    });
  });
});

describe('2. Invalid workflow JSON fails validation with a clear error', () => {
  it('rejects a file that is not valid JSON, naming the file', () => {
    const dir = makeTmpDir('grafista-workflows-');
    fs.writeFileSync(path.join(dir, 'broken-workflow.json'), '{ "workflow_id": "broken", ');
    expect(() => loadWorkflowDefinitions(dir)).toThrowError(/Workflow definition broken-workflow\.json is not valid JSON/);
  });

  it('rejects a definition missing required fields, naming the file and the fields', () => {
    const dir = makeTmpDir('grafista-workflows-');
    fs.writeFileSync(path.join(dir, 'missing-fields-workflow.json'), JSON.stringify({ workflow_id: 'incomplete' }));
    expect(() => loadWorkflowDefinitions(dir)).toThrowError(/Workflow definition missing-fields-workflow\.json failed validation:.*name/s);
  });

  it('rejects duplicate step_id values within a definition', () => {
    const dir = makeTmpDir('grafista-workflows-');
    const def = minimalDefinition([minimalStep('same_step', 1), minimalStep('same_step', 2)]);
    fs.writeFileSync(path.join(dir, 'duplicate-step-workflow.json'), JSON.stringify(def));
    expect(() => loadWorkflowDefinitions(dir)).toThrowError(/duplicate step_id 'same_step'/);
  });

  it('rejects duplicate step orders within a definition', () => {
    const dir = makeTmpDir('grafista-workflows-');
    const def = minimalDefinition([minimalStep('step_a', 1), minimalStep('step_b', 1)]);
    fs.writeFileSync(path.join(dir, 'duplicate-order-workflow.json'), JSON.stringify(def));
    expect(() => loadWorkflowDefinitions(dir)).toThrowError(/duplicate step order 1/);
  });
});

describe('3. Workflow referencing a broken/missing skill fails clearly', () => {
  it('fails catalog validation when a skills_used/step skill has no SKILL.md', () => {
    const dir = copyRealWorkflows();
    rewriteDefinition(dir, 'client-onboarding-workflow.json', (def) => {
      (def.skills_used as string[]).push('ghost-skill');
      (def.steps as Array<Record<string, unknown>>)[0].skill = 'ghost-skill';
    });
    expect(() => loadWorkflowCatalog({ workflowsDir: dir })).toThrowError(
      /Workflow catalog validation failed:[\s\S]*Skill file not found: .*ghost-skill.*referenced skill id: ghost-skill/
    );
  });

  it('fails catalog validation when a step references a skill missing from skills_used', () => {
    const dir = copyRealWorkflows();
    rewriteDefinition(dir, 'client-onboarding-workflow.json', (def) => {
      // 'style-analysis' is a real, loadable skill — but client-onboarding does
      // not list it in skills_used, so only the consistency rule can fire.
      (def.steps as Array<Record<string, unknown>>)[0].skill = 'style-analysis';
    });
    expect(() => loadWorkflowCatalog({ workflowsDir: dir })).toThrowError(
      /Workflow client-onboarding step create_client references skill 'style-analysis' that is not listed in skills_used/
    );
  });
});

describe('3b. Step-binding cross-validation catches unbound/orphan steps', () => {
  it('fails catalog validation when a workflow step has no registered binding', () => {
    const dir = copyRealWorkflows();
    rewriteDefinition(dir, 'client-onboarding-workflow.json', (def) => {
      (def.steps as Array<Record<string, unknown>>).push(minimalStep('brand_new_unbound_step', 999));
    });
    expect(() => loadWorkflowCatalog({ workflowsDir: dir })).toThrowError(
      /No step binding registered for client-onboarding\/brand_new_unbound_step/
    );
  });

  it('fails catalog validation when a registered binding key has no matching workflow step', () => {
    const dir = copyRealWorkflows();
    rewriteDefinition(dir, 'client-onboarding-workflow.json', (def) => {
      def.steps = (def.steps as Array<Record<string, unknown>>).filter((s) => s.step_id !== 'save_profile');
    });
    expect(() => loadWorkflowCatalog({ workflowsDir: dir })).toThrowError(
      /Step binding 'client-onboarding\/save_profile' does not match any workflow step/
    );
  });
});

describe('4. Malformed SKILL.md fails clearly', () => {
  it('reports a missing required section with the file path', () => {
    const dir = makeTmpDir('grafista-skills-');
    writeSkill(dir, 'no-checklist', validSkillMd('no-checklist').replace(/## Checklist\n- \[ \] fixture\n\n/, ''));
    expect(() => loadSkill('no-checklist', dir)).toThrowError(
      /Skill file .*no-checklist.*SKILL\.md is malformed: missing required section '## Checklist'/
    );
  });

  it('reports missing frontmatter fields with the file path', () => {
    const dir = makeTmpDir('grafista-skills-');
    writeSkill(dir, 'no-frontmatter', '# No Frontmatter\n\n## When to Use\n- fixture\n');
    expect(() => loadSkill('no-frontmatter', dir)).toThrowError(
      /Skill file .*no-frontmatter.*SKILL\.md is malformed: missing frontmatter field 'name'/
    );

    const noDescription = validSkillMd('no-description').replace('description: Test skill fixture\n', '');
    writeSkill(dir, 'no-description', noDescription);
    expect(() => loadSkill('no-description', dir)).toThrowError(/missing frontmatter field 'description'/);
  });

  it('reports a frontmatter name that does not match the directory name, stating both', () => {
    const dir = makeTmpDir('grafista-skills-');
    writeSkill(dir, 'actual-dir-name', validSkillMd('some-other-name'));
    expect(() => loadSkill('actual-dir-name', dir)).toThrowError(
      /frontmatter name 'some-other-name' does not match its directory name 'actual-dir-name'/
    );
  });

  it('reports a missing skill file with path and referenced id', () => {
    const dir = makeTmpDir('grafista-skills-');
    expect(() => loadSkill('does-not-exist', dir)).toThrowError(
      /Skill file not found: .*does-not-exist.*SKILL\.md \(referenced skill id: does-not-exist\)/
    );
  });

  it('loadSkills aggregates every individual failure into one error', () => {
    const dir = makeTmpDir('grafista-skills-');
    writeSkill(dir, 'healthy-skill', validSkillMd('healthy-skill'));
    writeSkill(dir, 'broken-skill', validSkillMd('broken-skill').replace(/## Failure Conditions\n- fixture\n/, ''));
    expect(() => loadSkills(['healthy-skill', 'broken-skill', 'missing-skill'], dir)).toThrowError(
      /Failed to load 2 skill\(s\):[\s\S]*broken-skill[\s\S]*missing-skill/
    );
    // The same list without the broken ids loads fine.
    const skills = loadSkills(['healthy-skill'], dir);
    expect(skills.get('healthy-skill')?.name).toBe('healthy-skill');
  });
});
