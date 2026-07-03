/**
 * Grafista AI Studio — Skill Loader (Phase 2 Step 6)
 *
 * Loads and validates the .agents/skills/<id>/SKILL.md files the workflow
 * definitions reference. Every skill file must carry a YAML frontmatter
 * (name + description, name matching the directory) and the five canonical
 * body sections — anything else is a malformed skill and fails loudly with
 * the file path in the message, so a broken reference can never silently
 * turn a workflow step into a no-op.
 *
 * The frontmatter is parsed with a small regex on purpose (no new YAML
 * dependency): the files only ever carry two scalar `key: value` lines.
 *
 * Deliberate decision: skills are NOT injected into the existing AI
 * services' prompts — those services own their prompts (prompt-engine
 * templates). The engine only stores a compact skill context
 * (buildSkillStepContext) into each ai_task step's input_json for
 * traceability/UI, never to rewrite what the services send to providers.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const SKILLS_DIR = path.resolve(__dirname, '../../../../.agents/skills');

export interface LoadedSkill {
  id: string;
  name: string;
  description: string;
  whenToUse: string;
  inputExpectations: string;
  outputExpectations: string;
  checklist: string;
  failureConditions: string;
  raw: string;
}

/** The canonical section headings every SKILL.md must contain, mapped to LoadedSkill fields. */
const REQUIRED_SECTIONS = [
  ['When to Use', 'whenToUse'],
  ['Input Expectations', 'inputExpectations'],
  ['Output Expectations', 'outputExpectations'],
  ['Checklist', 'checklist'],
  ['Failure Conditions', 'failureConditions'],
] as const;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Strips one matching pair of surrounding single or double quotes, if present. */
function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'")))) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function malformed(filePath: string, detail: string): Error {
  return new Error(`Skill file ${filePath} is malformed: ${detail}`);
}

function extractFrontmatterField(frontmatter: string, field: string, filePath: string): string {
  const match = frontmatter.match(new RegExp(`^${field}:(.*)$`, 'm'));
  const value = match ? stripQuotes(match[1]) : '';
  if (!value) {
    throw malformed(filePath, `missing frontmatter field '${field}'`);
  }
  return value;
}

function extractSection(body: string, heading: string, filePath: string): string {
  // The `m` flag is needed so `^##\s+<heading>` can match a heading anywhere in the body,
  // not just at its very start — but that same flag makes a bare `$` match at EVERY line
  // end, which would stop the lazy `[\s\S]*?` capture after just the first line of the
  // section. `(?![\s\S])` asserts true end-of-string regardless of the `m` flag, so the
  // capture instead runs to the next `## ` heading or genuinely to the end of the body.
  const match = body.match(new RegExp(`^##\\s+${escapeRegExp(heading)}\\s*\\r?\\n([\\s\\S]*?)(?=\\r?\\n##\\s|(?![\\s\\S]))`, 'm'));
  if (!match) {
    throw malformed(filePath, `missing required section '## ${heading}'`);
  }
  return match[1].trim();
}

/** Loads and validates one skill by its directory name (which doubles as its id). */
export function loadSkill(dirName: string, dir: string = SKILLS_DIR): LoadedSkill {
  const filePath = path.join(dir, dirName, 'SKILL.md');
  if (!fs.existsSync(filePath)) {
    throw new Error(`Skill file not found: ${filePath} (referenced skill id: ${dirName})`);
  }
  const raw = fs.readFileSync(filePath, 'utf8');

  const frontmatterMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const frontmatter = frontmatterMatch ? frontmatterMatch[1] : '';
  const name = extractFrontmatterField(frontmatter, 'name', filePath);
  const description = extractFrontmatterField(frontmatter, 'description', filePath);

  if (name !== dirName) {
    throw malformed(filePath, `frontmatter name '${name}' does not match its directory name '${dirName}'`);
  }

  const body = frontmatterMatch ? raw.slice(frontmatterMatch[0].length) : raw;
  const sections = {} as Record<(typeof REQUIRED_SECTIONS)[number][1], string>;
  for (const [heading, field] of REQUIRED_SECTIONS) {
    sections[field] = extractSection(body, heading, filePath);
  }

  return {
    id: dirName,
    name,
    description,
    whenToUse: sections.whenToUse,
    inputExpectations: sections.inputExpectations,
    outputExpectations: sections.outputExpectations,
    checklist: sections.checklist,
    failureConditions: sections.failureConditions,
    raw,
  };
}

/** Loads a set of skills, aggregating every individual failure into one clear error. */
export function loadSkills(ids: string[], dir: string = SKILLS_DIR): Map<string, LoadedSkill> {
  const skills = new Map<string, LoadedSkill>();
  const errors: string[] = [];
  for (const id of new Set(ids)) {
    try {
      skills.set(id, loadSkill(id, dir));
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }
  if (errors.length > 0) {
    throw new Error(`Failed to load ${errors.length} skill(s):\n- ${errors.join('\n- ')}`);
  }
  return skills;
}

/**
 * Compact skill context stored into an ai_task step's input_json.skillContext at run
 * start — traceability for the dashboard/API, deliberately NOT injected into the AI
 * services' prompts (the services own their prompts, see module header).
 */
export function buildSkillStepContext(skill: LoadedSkill): {
  skillId: string;
  description: string;
  whenToUse: string;
  checklist: string;
} {
  return {
    skillId: skill.id,
    description: skill.description,
    whenToUse: skill.whenToUse,
    checklist: skill.checklist,
  };
}
