-- Go-live M6 (direct-photo listing cards): allow generation_method 'uploaded'
-- for a user-uploaded property photo composited into a layout slot (not
-- AI-generated). Additive — every existing value stays valid; only a new
-- allowed value is added. Matches the @grafista/schemas GeneratedOutput
-- generationMethod enum.

ALTER TABLE generated_outputs
  DROP CONSTRAINT IF EXISTS generated_outputs_generation_method_check;

ALTER TABLE generated_outputs
  ADD CONSTRAINT generated_outputs_generation_method_check
  CHECK (generation_method IN ('ai_generated', 'template_based', 'manual', 'photoshop_worker', 'uploaded'));
