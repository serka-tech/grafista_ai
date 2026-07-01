# Grafista AI Studio — Architecture

## System Overview

Grafista AI Studio is a **brand-aware creative workflow system** built as a TypeScript monorepo. It helps advertising agencies produce client-specific social media content and design briefs with AI assistance.

```
┌─────────────────────────────────────────────────────────────┐
│                    Dashboard (Next.js)                      │
│   Clients · Brand · DNA · Content · Approvals · Briefs     │
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTP/REST
┌──────────────────────────▼──────────────────────────────────┐
│                      API Server (Express)                    │
│  Routes · Services · Approval Gates · Mock Data Store       │
└────┬──────────────┬──────────────┬──────────────────────────┘
     │              │              │
┌────▼────┐  ┌──────▼──────┐  ┌───▼────────────┐
│Ingestion│  │  AI Router  │  │   Photoshop    │
│ Worker  │  │   Worker    │  │    Worker      │
│(analyze)│  │  (dispatch) │  │  (Phase 2)     │
└────┬────┘  └──────┬──────┘  └───┬────────────┘
     │              │              │
┌────▼──────────────▼──────────────▼──────────────────────────┐
│              Shared Packages                                 │
│   @grafista/schemas · @grafista/prompt-engine                │
│   @grafista/model-router                                     │
└──────────────────────────┬──────────────────────────────────┘
                           │
          ┌────────────────▼────────────────┐
          │     AI Providers (External)      │
          │  OpenAI · Gemini · Claude        │
          │  KIE AI · Higgsfield            │
          └─────────────────────────────────┘
```

## Monorepo Structure

```
grafista-ai-studio/
├── apps/
│   ├── dashboard/          Next.js 14 App Router
│   └── api/                Express.js REST API
├── workers/
│   ├── ingestion-worker/   Brand/design file analysis
│   ├── ai-router/          AI request dispatcher
│   └── photoshop-worker/   PSD generation (Phase 2)
├── packages/
│   ├── schemas/            Zod schemas (shared types)
│   ├── prompt-engine/      Prompt templates + builder
│   └── model-router/       Provider abstraction layer
├── database/
│   ├── migrations/         PostgreSQL schema
│   └── seed/               Sample data
├── .agents/skills/         10 Antigravity skills
└── docs/                   Documentation
```

## Data Flow

1. **Client Onboarding**: User creates client → uploads brand assets → system normalizes to BrandProfile
2. **Design Reference Analysis**: Upload approved designs → Ingestion Worker analyzes → StyleAnalysis created
3. **Design DNA Synthesis**: Multiple StyleAnalysis results → AI synthesizes → DesignDNA document
4. **Content Generation**: User requests ideas → AI generates options using DNA + brand context
5. **Approval Gate**: Creative director reviews → approves/rejects → only approved ideas proceed
6. **Brief Generation**: Approved idea + DNA → structured DesignBrief with all specifications
7. **Layout Planning**: Brief → LayoutPlan JSON with precise layer definitions
8. **QA Review**: 9-point creative quality check → score + recommendations
9. **Output Production**: Layout → preview/PSD/export (Phase 2 for PSD)

## Technology Decisions

| Component | Technology | Rationale |
|-----------|-----------|-----------|
| Monorepo | pnpm workspaces | Fast, efficient disk usage, native workspace protocol |
| API | Express.js + TypeScript | Mature, well-supported, easy to extend |
| Dashboard | Next.js 14 App Router | SSR/SSG, file-based routing, React Server Components |
| Schemas | Zod | Runtime validation + TypeScript inference |
| Database | PostgreSQL + pgvector | Relational + vector search for style similarity |
| AI Router | Custom abstraction | Provider-agnostic with fallback chains |
