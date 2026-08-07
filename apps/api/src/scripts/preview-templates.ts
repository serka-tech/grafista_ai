/**
 * Renders every template at every size to real PNGs, with no AI involved.
 *
 * This is the gate for the template phase: if the output here is not good, no
 * amount of prompt work later will fix it, because the model never touches
 * typography or layout. Run it and look at the files.
 *
 *   pnpm --filter @grafista/api exec tsx src/scripts/preview-templates.ts
 *
 * Writes to apps/api/.preview/ (gitignored).
 */
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

import { checkRenderedDesign } from '../qa/pixel-check.js';
import { closeRenderBrowser, renderTemplateHtml } from '../templates/render.js';
import { listTemplates } from '../templates/registry.js';
import { layoutModeFor, type TemplateInput, type TemplateSize } from '../templates/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, '../../.preview');

const SIZES: { id: string; size: TemplateSize; safeArea: { top: number; bottom: number } }[] = [
  { id: 'kare-1080x1080', size: { width: 1080, height: 1080 }, safeArea: { top: 0, bottom: 0 } },
  // Story chrome covers roughly the top 14% and bottom 20% of the canvas.
  { id: 'story-1080x1920', size: { width: 1080, height: 1920 }, safeArea: { top: 0.14, bottom: 0.2 } },
  { id: 'yatay-1200x628', size: { width: 1200, height: 628 }, safeArea: { top: 0, bottom: 0 } },
];

/**
 * Deliberately awkward Turkish: dotted and dotless i together, ğ ş ç ö ü, an
 * apostrophe, and the lira sign. If any of these render as a box the phase is
 * not done, however good the layout looks.
 */
const COPY = {
  headline: 'Işığın izinde: İstanbul’da iyi şubat',
  subline: 'Güneşli günlerde çayınızı bahçede içmenin tam sırası. Öğleden sonra 15.00’e kadar açığız.',
  badge: 'Yeni',
  cta: 'Rezervasyon için arayın',
  attribution: 'Ayşe Şıklığıoğlu',
};

/** A stand-in brand kit. No real client data, no network. */
const BRAND = {
  name: 'Çiğdem Kahve',
  palette: {
    primary: '#0f766e',
    secondary: '#134e4a',
    accent: '#f59e0b',
    background: '#0b1f1d',
    text: '#f8fafc',
  },
  headingFont: "'Montserrat'",
  bodyFont: "'Inter'",
};

/** A tiny inline SVG stands in for the client logo so nothing is fetched. */
const LOGO_DATA_URI =
  'data:image/svg+xml;base64,' +
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="80" viewBox="0 0 320 80">
      <rect width="320" height="80" rx="14" fill="#f8fafc"/>
      <circle cx="42" cy="40" r="20" fill="#0f766e"/>
      <text x="76" y="52" font-family="Helvetica,Arial" font-size="30" font-weight="700" fill="#0b1f1d">ÇİĞDEM</text>
    </svg>`
  ).toString('base64');

/**
 * A synthetic photograph: a warm gradient with enough structure that blur,
 * scrim and edge-density measurements all have something real to act on. Solid
 * colour would make every QA number look perfect and prove nothing.
 */
function syntheticPhoto(width: number, height: number): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <defs>
      <linearGradient id="sky" x1="0" y1="0" x2="0.3" y2="1">
        <stop offset="0%" stop-color="#fde68a"/>
        <stop offset="45%" stop-color="#fb923c"/>
        <stop offset="100%" stop-color="#7c2d12"/>
      </linearGradient>
    </defs>
    <rect width="${width}" height="${height}" fill="url(#sky)"/>
    <circle cx="${width * 0.72}" cy="${height * 0.24}" r="${Math.min(width, height) * 0.14}" fill="#fff7ed" opacity="0.85"/>
    ${Array.from({ length: 9 }, (_, i) => {
      const x = (width / 9) * i;
      const h = height * (0.18 + ((i * 37) % 23) / 100);
      return `<rect x="${x}" y="${height - h}" width="${width / 9 - 6}" height="${h}" fill="#431407" opacity="${0.35 + (i % 3) * 0.12}"/>`;
    }).join('')}
  </svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });

  let rendered = 0;
  let withIssues = 0;

  for (const template of listTemplates()) {
    for (const variant of SIZES) {
      const mode = layoutModeFor(variant.size);
      if (!template.supports.includes(mode)) continue;

      // A carousel is a deck, so render the whole thing. All three cards share
      // one background image, which is the point of the format here.
      const cards =
        template.id === 'carousel'
          ? [
              { index: 0, total: 3, copy: COPY },
              { index: 1, total: 3, copy: { ...COPY, headline: 'Çekirdeği ışığa göre seçiyoruz' } },
              { index: 2, total: 3, copy: { ...COPY, headline: 'Sizi bekliyoruz' } },
            ]
          : [{ index: 0, total: 1, copy: COPY }];

      const sharedPhoto = syntheticPhoto(variant.size.width, variant.size.height);

      for (const card of cards) {
      const input: TemplateInput = {
        size: variant.size,
        brand: { ...BRAND, logoDataUri: LOGO_DATA_URI },
        copy: card.copy,
        background: template.needsBackgroundImage
          ? { kind: 'ai-image', dataUri: sharedPhoto, blurPx: 4 }
          : { kind: 'brand-gradient' },
        safeArea: variant.safeArea,
        ...(cards.length > 1 ? { card: { index: card.index, total: card.total } } : {}),
      };

      const output = template.render(input);
      const result = await renderTemplateHtml(output.html, variant.size);

      const suffix = cards.length > 1 ? `__kart${card.index + 1}` : '';
      const fileName = `${template.id}__${variant.id}${suffix}.png`;
      await writeFile(path.join(OUT_DIR, fileName), result.png);
      rendered += 1;

      const report = await checkRenderedDesign({
        render: result,
        textRects: output.textRects,
        textColor: BRAND.palette.text,
      });

      const contrast = report.measurements.regions
        .map((region) => region.contrast.toFixed(1))
        .join(', ');
      const status = report.passed ? 'temiz' : `${report.issues.length} uyarı → ${report.remedy}`;
      if (!report.passed) withIssues += 1;

      console.log(
        `${fileName.padEnd(46)} kontrast=[${contrast}]  ` +
          `varyans=${report.measurements.canvasStdDev.toFixed(3)}  ${status}`
      );
      for (const issue of report.issues) {
        console.log(`    - ${issue.code}: ${issue.message}`);
      }
      }
    }
  }

  console.log(`\n${rendered} önizleme üretildi, ${withIssues} tanesinde uyarı var.`);
  console.log(`Klasör: ${OUT_DIR}`);

  await closeRenderBrowser();
}

main().catch(async (err) => {
  console.error(err);
  await closeRenderBrowser();
  process.exit(1);
});
