# Grafista AI Studio — Photoshop Automation Plan

> **STATUS (2026-07-04, Step 10R): PARKED / OPTIONAL — nothing below is
> implemented, and none of it is current Phase 2 scope.** The strategy changed
> during Phase 2: the primary production line is the AI-driven design +
> automatic render/export pipeline (HTML/CSS + Playwright, shipped in Steps
> 9A/9B). Photoshop/PSD/UXP is an optional professional finalization/handoff
> layer for a later phase — the production package's template contract
> (`rendererCompatibilityHints`, manifest v2) already carries everything this
> plan would need, so it can be picked up without format changes. See
> `docs/roadmap.md` ("Production strategy") before acting on anything here.

## Original Phase 2 Objective (superseded — kept for reference)

Connect Grafista AI Studio to Adobe Photoshop via UXP (Unified Extensibility Platform) to automatically generate editable PSD files from LayoutPlan JSON.

## Architecture

```
LayoutPlan JSON
      ↓
Photoshop Worker (Node.js)
      ↓ (HTTP/WebSocket)
Photoshop UXP Plugin
      ↓
Adobe Photoshop
      ↓
Generated PSD + Exports
```

## UXP Plugin Capabilities

1. **Document Creation**: Set canvas size, DPI, color profile
2. **Layer Management**: Create text, image, shape, group layers
3. **Text Rendering**: Set font, size, weight, color, alignment
4. **Image Placement**: Insert and position images, apply transforms
5. **Shape Drawing**: Rectangles, circles, paths with fill/stroke
6. **Export**: PNG, JPG, PDF, PSD save

## LayoutPlan → PSD Mapping

| LayoutPlan Layer | Photoshop Action |
|-----------------|------------------|
| `background` | Create background layer with fill color/gradient |
| `image` | Place embedded image, set position/size |
| `text` | Create text layer with full typography specs |
| `shape` | Create shape layer with fill/stroke |
| `logo` | Place logo smart object at specified position |
| `overlay` | Create semi-transparent layer |
| `gradient` | Apply gradient fill |
| `group` | Create layer group with children |

## Implementation Steps

1. **UXP Plugin Development**: Create Photoshop plugin with JSON API endpoint
2. **Worker Service**: HTTP server that accepts LayoutPlan and communicates with UXP
3. **Preview Generation**: Export PNG preview after PSD creation
4. **Error Handling**: Validate LayoutPlan, handle missing fonts/images
5. **Batch Processing**: Queue-based multi-file generation

## Requirements

- Adobe Photoshop 2024+ with UXP support
- Node.js worker running on same machine as Photoshop
- Network access between API server and Photoshop worker

## Current Status

- Service contract defined (`PSDGenerationRequest` / `PSDGenerationResult`)
- LayoutPlan schema complete with all layer types
- Placeholder worker returns `not_implemented` status
- Ready for Phase 2 implementation
