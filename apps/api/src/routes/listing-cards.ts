import { Router, Request, Response } from 'express';
import { requireAuth, requirePermission } from '../auth/middleware.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { upload } from '../middleware/upload.js';
import { createListingCard } from '../services/listing-card.js';
import type { ListingPreset } from '../services/real-estate-template.js';

export const listingCardsRouter: Router = Router();

const LISTING_PRESETS: ListingPreset[] = ['instagram_post', 'instagram_story'];

/**
 * POST /api/clients/:clientId/listing-cards — go-live M6 direct-photo.
 *
 * Multipart: `file` (property photo) + fields { preset?, price, title, address?, agencyName? }.
 * Creates a curated real-estate listing card as a production-ready `generated_output`
 * (generationMethod 'uploaded') that composites the uploaded photo into the layout's
 * hero slot. Send it to production + render with the existing endpoints, exactly like an
 * AI-generated visual output.
 */
listingCardsRouter.post(
  '/:clientId/listing-cards',
  requireAuth,
  requirePermission('visual_generation:run'),
  upload.single('file'),
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.file) {
      return res.status(400).json({ error: 'A property photo file is required (multipart field "file").' });
    }
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(req.file.mimetype)) {
      return res.status(400).json({ error: `Unsupported image type ${req.file.mimetype} — use PNG, JPEG or WebP.` });
    }

    const presetRaw = (req.body.preset as string) ?? 'instagram_post';
    if (!LISTING_PRESETS.includes(presetRaw as ListingPreset)) {
      return res.status(400).json({ error: `preset must be one of: ${LISTING_PRESETS.join(', ')}` });
    }
    const preset = presetRaw as ListingPreset;

    const price = ((req.body.price as string) ?? '').trim();
    const title = ((req.body.title as string) ?? '').trim();
    if (!price || !title) {
      return res.status(400).json({ error: 'price and title are required.' });
    }

    const output = await createListingCard({
      clientId: req.params.clientId,
      preset,
      fields: {
        title,
        price,
        address: ((req.body.address as string) ?? '').trim(),
        agencyName: ((req.body.agencyName as string) ?? '').trim(),
      },
      file: { buffer: req.file.buffer, mimetype: req.file.mimetype, originalname: req.file.originalname },
      requestedBy: req.user!.id,
    });

    res.status(201).json({ data: output });
  })
);
