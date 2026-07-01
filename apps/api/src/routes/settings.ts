import { Router, Request, Response } from 'express';
import { ModelRouter } from '@grafista/model-router';

export const settingsRouter: Router = Router();

const router = new ModelRouter();

// GET /api/settings/providers — AI provider status
settingsRouter.get('/settings/providers', (_req: Request, res: Response) => {
  const status = router.getProviderStatus();
  const providers = Object.entries(status).map(([name, available]) => ({
    name,
    available,
    status: available ? 'connected' : 'not_configured',
    envVar: {
      openai: 'OPENAI_API_KEY',
      gemini: 'GEMINI_API_KEY',
      claude: 'ANTHROPIC_API_KEY',
      'kie-ai': 'KIE_AI_API_KEY',
      higgsfield: 'HIGGSFIELD_API_KEY',
    }[name] ?? 'UNKNOWN',
  }));

  res.json({ data: providers });
});
