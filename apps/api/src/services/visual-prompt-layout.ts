/**
 * Grafista AI Studio — Semantic Layout Description for the Image Prompt
 * (F8 fix, Production go-live M2.3)
 *
 * Turns an approved LayoutPlan into a natural-language composition brief for the
 * IMAGE generation model, WITHOUT the raw pixel-coordinate numbers that used to
 * leak. The previous prompt fed the layout as raw JSON (`position: { x: 30, ... }`)
 * with a "reproduce faithfully" instruction, and the model rendered those literal
 * coordinates as visible text — e.g. "(30, 30)" — on the finished creative
 * (friction F8, docs/demo-rehearsal-checklist.md). This description conveys the
 * same intent (each layer's role, copy, color, font, qualitative size and RELATIVE
 * placement) but never emits an x/y/width/height integer, so there is nothing
 * coordinate-like for the model to draw as a label.
 *
 * Pure and deterministic — same layout always yields the same text. Reuses the
 * renderer's flattenLayers so the traversal/visibility rules stay identical to
 * what actually renders.
 */

import type { Layer, LayoutPlan } from '@grafista/schemas';
import { flattenLayers } from '../render/html-renderer.js';

function cap(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** Relative position bucket (thirds of the canvas) for a layer's center — never a pixel value. */
function relativePlacement(layer: Layer, canvasWidth: number, canvasHeight: number): string {
  const cx = layer.position.x + layer.position.width / 2;
  const cy = layer.position.y + layer.position.height / 2;
  const h = cx < canvasWidth / 3 ? 'left' : cx > (canvasWidth * 2) / 3 ? 'right' : 'center';
  const v = cy < canvasHeight / 3 ? 'top' : cy > (canvasHeight * 2) / 3 ? 'bottom' : 'middle';
  if (v === 'middle' && h === 'center') return 'centered';
  return `${v} ${h}`;
}

/** Qualitative text size relative to canvas height — avoids emitting the fontSize number. */
function qualitativeTextSize(fontSize: number, canvasHeight: number): string {
  const ratio = fontSize / canvasHeight;
  if (ratio >= 0.08) return 'very large';
  if (ratio >= 0.05) return 'large';
  if (ratio >= 0.03) return 'medium';
  return 'small';
}

export function describeLayoutForImagePrompt(layoutPlan: LayoutPlan): string {
  const { canvas } = layoutPlan;
  const lines: string[] = [];

  const all = flattenLayers(layoutPlan.layers);
  // A background-type layer's own fill (which the renderer honors, html-renderer.ts)
  // can differ from canvas.backgroundColor — prefer it so the description matches.
  const bgLayer = all.find((l) => l.type === 'background' && l.shapeProperties?.fillColor);
  const bg = bgLayer?.shapeProperties?.fillColor || canvas.backgroundColor || '#FFFFFF';
  lines.push(
    `Overall format: ${layoutPlan.format}. Background color reference: ${bg}. ` +
      'The separately supplied brand palette overrides conflicting layout-level color choices; never make the whole canvas one solid color.'
  );

  const visible = all
    .filter((l) => l.visible !== false && l.type !== 'background')
    .sort((a, b) => a.zIndex - b.zIndex);

  for (const layer of visible) {
    const where = relativePlacement(layer, canvas.width, canvas.height);
    switch (layer.type) {
      case 'text': {
        const tp = layer.textProperties;
        const content = tp?.content ?? '';
        const size = tp ? qualitativeTextSize(tp.fontSize, canvas.height) : 'medium';
        const font = tp?.fontFamily ? `, font ${tp.fontFamily}` : '';
        const color = tp?.color ? `, color ${tp.color}` : '';
        lines.push(`- Text, ${where}: render the exact words "${content}", ${size}${font}${color}.`);
        break;
      }
      case 'logo': {
        lines.push(`- Brand logo placed ${where} (keep it clean, do not distort or relabel it).`);
        break;
      }
      case 'image': {
        const ip = layer.imageProperties;
        const src = ip?.sourceType ?? 'placeholder';
        const kind =
          src === 'ai_generated'
            ? 'generated imagery'
            : src === 'uploaded'
              ? 'the uploaded photo'
              : src === 'stock'
                ? 'stock-style imagery'
                : 'imagery';
        // Restore the per-region subject guidance (aiPrompt) the old raw-JSON prompt
        // carried — it describes WHAT to depict, not a coordinate, so it is safe to keep.
        const subject = ip?.aiPrompt ? ` showing ${ip.aiPrompt}` : '';
        lines.push(`- Image area, ${where}: ${kind}${subject} filling the region.`);
        break;
      }
      case 'shape':
      case 'gradient':
      case 'overlay':
      case 'border': {
        const fill = layer.shapeProperties?.fillColor;
        lines.push(`- ${cap(layer.type)} accent placed ${where}${fill ? `, color ${fill}` : ''}.`);
        break;
      }
      default:
        // icon / group / anything else — describe generically, still no coordinates.
        lines.push(`- ${cap(layer.type)} element placed ${where}.`);
    }
  }

  if (layoutPlan.colorUsageNotes) lines.push(`Color usage: ${layoutPlan.colorUsageNotes}`);
  if (layoutPlan.typographyNotes) lines.push(`Typography: ${layoutPlan.typographyNotes}`);

  return lines.join('\n');
}
