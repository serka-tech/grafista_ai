'use client';

/**
 * DemoStepNote — a small "Bu ekranda ne gösterilir?" anchor for the two screens
 * the DemoFlowGuide (demo-flow-guide.tsx) sends a presenter to WITHOUT a labeled
 * button of its own: the content generator (steps 5-6) and the layout-plans page
 * (steps 7-9). Landing on those screens mid-demo, a viewer otherwise loses the
 * "MVP Demo Akışı" thread; this one line restates which step they are on and what
 * to do here. It adds no module, no data fetch, and no behavior — purely
 * presentational, static, honest demo language, styled to match the existing
 * `badge badge-info` + glass-card idiom used across the demo surfaces.
 */
export function DemoStepNote({ step, text }: { step: string; text: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        flexWrap: 'wrap',
        marginBottom: '24px',
        padding: '8px 12px',
        borderRadius: 'var(--radius-md)',
        background: 'var(--color-bg-glass)',
        fontSize: '0.8rem',
        color: 'var(--color-text-secondary)',
      }}
    >
      <span className="badge badge-info" style={{ flex: '0 0 auto' }}>
        🎬 {step}
      </span>
      <span>{text}</span>
    </div>
  );
}
