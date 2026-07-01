-- ═══════════════════════════════════════════════════════════
-- Grafista AI Studio — pgvector Extension
-- Adds vector embedding support for semantic search
-- ═══════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS vector;

-- Add embedding columns to tables that benefit from semantic search

-- Brand profiles: embed brand description for similarity matching
ALTER TABLE brand_profiles ADD COLUMN IF NOT EXISTS
  description_embedding vector(1536);

-- Design references: embed visual analysis for design similarity search
ALTER TABLE design_references ADD COLUMN IF NOT EXISTS
  style_embedding vector(1536);

-- Content ideas: embed content for duplicate detection and similarity
ALTER TABLE content_ideas ADD COLUMN IF NOT EXISTS
  content_embedding vector(1536);

-- Design DNA: embed DNA summary for client style matching
ALTER TABLE design_dna ADD COLUMN IF NOT EXISTS
  dna_embedding vector(1536);

-- Revision feedback: embed feedback for pattern detection
ALTER TABLE revision_feedback ADD COLUMN IF NOT EXISTS
  feedback_embedding vector(1536);

-- Create HNSW indexes for fast approximate nearest neighbor search
CREATE INDEX IF NOT EXISTS idx_brand_profiles_embedding
  ON brand_profiles USING hnsw (description_embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS idx_design_refs_embedding
  ON design_references USING hnsw (style_embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS idx_content_ideas_embedding
  ON content_ideas USING hnsw (content_embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS idx_design_dna_embedding
  ON design_dna USING hnsw (dna_embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS idx_feedback_embedding
  ON revision_feedback USING hnsw (feedback_embedding vector_cosine_ops);
