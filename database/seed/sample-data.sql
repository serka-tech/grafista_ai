-- ═══════════════════════════════════════════════════════════
-- Grafista AI Studio — Sample Data
-- "Flavora Organic" demo client
-- ═══════════════════════════════════════════════════════════

-- Insert sample client
INSERT INTO clients (id, name, slug, industry, website, contact_name, contact_email, status, notes)
VALUES (
  'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  'Flavora Organic',
  'flavora-organic',
  'Organic Food & Beverage',
  'https://flavora-organic.com',
  'Ayşe Kaya',
  'ayse@flavora-organic.com',
  'active',
  'Premium organic food brand. Focus on healthy, sustainable living. Target audience: health-conscious millennials and Gen-Z.'
);

-- Insert brand profile
INSERT INTO brand_profiles (id, client_id, brand_name, tagline, description, industry, target_audience, brand_personality, tone_of_voice, colors, fonts, rules, forbidden_elements)
VALUES (
  'b2c3d4e5-f6a7-8901-bcde-f12345678901',
  'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  'Flavora Organic',
  'Nature''s Best, Your Table',
  'Flavora Organic is a premium organic food brand committed to sustainable farming and healthy living. We bring nature''s finest ingredients to your table with love and care.',
  'Organic Food & Beverage',
  'Health-conscious millennials and Gen-Z, urban professionals, young families, sustainability advocates',
  '["authentic", "warm", "earthy", "trustworthy", "fresh", "premium"]',
  '["friendly", "informative", "inspiring", "natural", "positive"]',
  '[
    {"name": "Forest Green", "hex": "#2D5016", "usage": "Primary brand color", "isPrimary": true},
    {"name": "Warm Earth", "hex": "#8B6F47", "usage": "Secondary / accents", "isPrimary": false},
    {"name": "Cream White", "hex": "#FAF5EB", "usage": "Background", "isPrimary": false},
    {"name": "Leaf Green", "hex": "#6B9B37", "usage": "CTA buttons and highlights", "isPrimary": false},
    {"name": "Sunset Orange", "hex": "#E8913A", "usage": "Accent / seasonal campaigns", "isPrimary": false}
  ]',
  '[
    {"name": "Playfair Display", "family": "Playfair Display", "weight": "700", "usage": "heading"},
    {"name": "Inter", "family": "Inter", "weight": "400", "usage": "body"},
    {"name": "Inter Medium", "family": "Inter", "weight": "500", "usage": "subheading"}
  ]',
  '[
    {"id": "r1", "category": "required", "description": "Logo must appear on every post", "priority": "critical"},
    {"id": "r2", "category": "required", "description": "Use at least one earth tone color", "priority": "high"},
    {"id": "r3", "category": "guideline", "description": "Photography should feel natural and warm, never over-processed", "priority": "medium"},
    {"id": "r4", "category": "forbidden", "description": "Never use neon or electric colors", "priority": "critical"},
    {"id": "r5", "category": "forbidden", "description": "No stock photos of people with fake smiles", "priority": "high"},
    {"id": "r6", "category": "preferred", "description": "Include a sustainability message when possible", "priority": "medium"}
  ]',
  '["neon colors", "artificial-looking food", "generic stock photos", "aggressive sales language", "plastic imagery", "fast food aesthetic"]'
);

-- Insert brand assets
INSERT INTO brand_assets (client_id, type, name, metadata) VALUES
('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'logo', 'Flavora Primary Logo', '{"variant": "horizontal", "background": "light"}'),
('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'logo_variant', 'Flavora Icon Only', '{"variant": "icon", "background": "any"}'),
('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'color_palette', 'Primary Color Palette', '{"colorCount": 5}'),
('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'font', 'Playfair Display', '{"usage": "headings"}'),
('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'font', 'Inter', '{"usage": "body text"}');

-- Insert design references (mock — no actual files)
INSERT INTO design_references (id, client_id, name, description, tags, is_approved) VALUES
('d1a1a1a1-1111-1111-1111-111111111111', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'Instagram Post — Summer Harvest', 'Square post featuring fresh vegetables on wooden table', '["instagram", "summer", "product"]', true),
('d2b2b2b2-2222-2222-2222-222222222222', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'Instagram Story — Recipe Tips', 'Vertical story with recipe ingredients overlay', '["instagram", "story", "recipe"]', true),
('d3c3c3c3-3333-3333-3333-333333333333', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'Instagram Carousel — Farm to Table', '5-slide carousel showing farm-to-table journey', '["instagram", "carousel", "story-telling"]', true);

-- Approval for the already-approved content idea below (needed because
-- design_briefs.approval_id is NOT NULL + FK REFERENCES approvals(id))
INSERT INTO approvals (id, entity_type, entity_id, client_id, status, reviewer_role, approved_at)
VALUES (
  'f1a1a1a1-1111-1111-1111-111111111111',
  'content_idea',
  'e1a1a1a1-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  'approved',
  'creative_director',
  NOW()
);

-- Insert sample content ideas
INSERT INTO content_ideas (id, client_id, campaign_name, title, description, platform, format, hook, caption, hashtags, call_to_action, tone_of_voice, visual_direction, status, approval_id) VALUES
('e1a1a1a1-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'Summer Harvest Campaign', 'Fresh From the Farm — Summer Edition', 'Showcase summer seasonal products with vibrant, sun-drenched photography', 'instagram_post', 'single_image', 'The freshest flavors of summer are here 🌿', 'Nothing beats the taste of freshly picked organic produce. Our summer harvest is here, and it''s bursting with flavor! 🍅🥒🌽\n\nFrom our fields to your table — every bite is a celebration of nature.\n\n#FlavoraOrganic #FreshFromFarm #SummerHarvest #OrganicLiving', '["FlavoraOrganic", "FreshFromFarm", "SummerHarvest", "OrganicLiving", "HealthyEating"]', 'Shop Summer Collection →', 'warm, inviting, natural', 'Overhead shot of colorful summer vegetables on rustic wooden surface, natural sunlight, scattered herbs, warm earthy tones', 'approved', 'f1a1a1a1-1111-1111-1111-111111111111'),
('e2b2b2b2-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'Summer Harvest Campaign', 'Behind the Scenes — Our Organic Farm', 'Take followers on a visual journey through the organic farming process', 'instagram_carousel', 'carousel', 'Ever wondered where your food really comes from? 🌱', 'Slide into our world 🌾\n\n1️⃣ Seeds planted with care\n2️⃣ Growing under the sun\n3️⃣ Harvested by hand\n4️⃣ Delivered fresh to you\n5️⃣ On your table tonight!\n\n#FarmToTable #OrganicJourney #FlavoraOrganic', '["FarmToTable", "OrganicJourney", "FlavoraOrganic", "SustainableLiving"]', 'Follow our journey', 'authentic, storytelling', '5-slide progression from farm to table, consistent filter, earthy palette', 'pending_approval', NULL),
('e3c3c3c3-cccc-cccc-cccc-cccccccccccc', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', NULL, 'Quick Recipe — Summer Smoothie Bowl', 'A short recipe story showing how to make a healthy smoothie bowl with Flavora products', 'instagram_story', 'story', '2 minutes to your healthiest breakfast 🥤', 'Quick, healthy, and absolutely delicious! Try our Summer Smoothie Bowl recipe. All you need is love and fresh organic ingredients. 🫐🥭\n\n#FlavoraRecipe #SmoothieBowl', '["FlavoraRecipe", "SmoothieBowl", "HealthyBreakfast"]', 'Swipe up for full recipe', 'playful, energetic', 'Step-by-step vertical story, bright colors on cream background, ingredient close-ups', 'draft', NULL);
