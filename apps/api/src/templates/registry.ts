import { boldStatement } from './bold-statement.js';
import { carousel } from './carousel.js';
import { editorialFrame } from './editorial-frame.js';
import { offerBadge } from './offer-badge.js';
import { photoCaption } from './photo-caption.js';
import { quoteCard } from './quote-card.js';
import { splitDiagonal } from './split-diagonal.js';
import type { LayoutMode, TemplateDefinition } from './types.js';

/**
 * Every template the planner may choose from. Sector definitions name these ids
 * in `preferredTemplates`, and a test cross-checks the two lists so a rename
 * here cannot leave a sector pointing at a template that no longer exists.
 */
export const TEMPLATES: readonly TemplateDefinition[] = [
  {
    id: 'bold-statement',
    label: 'Vurgulu Başlık',
    supports: ['square', 'portrait', 'landscape'],
    needsBackgroundImage: true,
    render: boldStatement,
  },
  {
    id: 'photo-caption',
    label: 'Fotoğraf ve Panel',
    supports: ['square', 'portrait', 'landscape'],
    needsBackgroundImage: true,
    render: photoCaption,
  },
  {
    id: 'split-diagonal',
    label: 'Diyagonal Bölünme',
    supports: ['square', 'portrait', 'landscape'],
    needsBackgroundImage: true,
    render: splitDiagonal,
  },
  {
    id: 'editorial-frame',
    label: 'Dergi Çerçevesi',
    supports: ['square', 'portrait', 'landscape'],
    needsBackgroundImage: true,
    render: editorialFrame,
  },
  {
    id: 'offer-badge',
    label: 'Kampanya Rozeti',
    supports: ['square', 'portrait', 'landscape'],
    needsBackgroundImage: true,
    render: offerBadge,
  },
  {
    id: 'quote-card',
    label: 'Alıntı Kartı',
    supports: ['square', 'portrait', 'landscape'],
    // Draws its own brand gradient, so a plan that leans on this template
    // spends nothing on image generation for those slots.
    needsBackgroundImage: false,
    render: quoteCard,
  },
  {
    id: 'carousel',
    label: 'Çoklu Kart',
    // Square only. A story-shaped carousel is not a format any platform offers,
    // and a landscape one would crop to nothing when swiped.
    supports: ['square'],
    needsBackgroundImage: true,
    render: carousel,
  },
];

const BY_ID = new Map(TEMPLATES.map((template) => [template.id, template]));

export function getTemplate(id: string): TemplateDefinition | undefined {
  return BY_ID.get(id);
}

export function listTemplates(): readonly TemplateDefinition[] {
  return TEMPLATES;
}

export function templateIds(): string[] {
  return TEMPLATES.map((template) => template.id);
}

export function templatesForMode(mode: LayoutMode): TemplateDefinition[] {
  return TEMPLATES.filter((template) => template.supports.includes(mode));
}

/**
 * The template to fall back to when pixel QA says the background is defeating
 * the text. Its panel is opaque, so contrast no longer depends on the photo.
 */
export const SAFE_FALLBACK_TEMPLATE_ID = 'photo-caption';
