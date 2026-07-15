'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, friendlyAiErrorMessage } from '@/lib/api';
import { formatLabel, moodLabel } from '@/lib/enum-labels';

const STATUS_BADGES: Record<string, { class: string; label: string }> = {
  draft: { class: 'badge-neutral', label: 'Taslak' },
  generated: { class: 'badge-info', label: 'Oluşturuldu' },
  waiting_for_approval: { class: 'badge-warning', label: 'Onay Bekliyor' },
  approved: { class: 'badge-success', label: 'Onaylandı' },
  needs_revision: { class: 'badge-danger', label: 'Revizyon Gerekiyor' },
};

function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p style={{ color: 'var(--color-danger, #f87171)', fontSize: '0.85rem', marginTop: '8px' }}>
      ⚠ {message}
    </p>
  );
}

export default function DesignDNAPage({ params }: { params: { id: string } }) {
  const clientId = params.id;

  const [permissions, setPermissions] = useState<string[]>([]);
  const [dna, setDNA] = useState<any>(null);
  const [dnaLoadError, setDnaLoadError] = useState<string | null>(null);
  const [analyses, setAnalyses] = useState<any[]>([]);
  const [references, setReferences] = useState<any[]>([]);

  const [loading, setLoading] = useState(true);

  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);

  const [approving, setApproving] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);

  const [revising, setRevising] = useState(false);
  const [reviseError, setReviseError] = useState<string | null>(null);
  const [reviseNotes, setReviseNotes] = useState('');

  const loadAll = useCallback(async () => {
    const [userResult, dnaResult, analysesResult, referencesResult] = await Promise.allSettled([
      api.getCurrentUser(),
      api.getDesignDNA(clientId),
      api.getDesignDnaReferences(clientId),
      api.getDesignReferences(clientId),
    ]);

    setPermissions(userResult.status === 'fulfilled' ? (userResult.value.data.user?.permissions ?? []) : []);

    if (dnaResult.status === 'fulfilled') {
      setDNA(dnaResult.value.data);
      setDnaLoadError(null);
    } else {
      setDNA(null);
      const msg = dnaResult.reason?.message ?? '';
      // "Design DNA not found..." is the expected 404 for a client that hasn't been analyzed
      // yet — that's not a load failure, it's the normal empty state.
      setDnaLoadError(/not found/i.test(msg) ? null : (msg || 'Tasarım DNA yüklenirken hata oluştu.'));
    }

    setAnalyses(analysesResult.status === 'fulfilled' ? (analysesResult.value.data ?? []) : []);
    setReferences(referencesResult.status === 'fulfilled' ? (referencesResult.value.data ?? []) : []);
  }, [clientId]);

  useEffect(() => {
    setLoading(true);
    loadAll().finally(() => setLoading(false));
  }, [loadAll]);

  async function handleAnalyze() {
    setAnalyzing(true);
    setAnalyzeError(null);
    try {
      await api.analyzeDesignDNA(clientId);
      await loadAll();
    } catch (err: any) {
      setAnalyzeError(friendlyAiErrorMessage(err, 'Analiz başarısız oldu.'));
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleApprove() {
    setApproving(true);
    setApproveError(null);
    try {
      await api.approveDesignDna(clientId);
      await loadAll();
    } catch (err: any) {
      setApproveError(err.message ?? 'Onaylama başarısız oldu.');
    } finally {
      setApproving(false);
    }
  }

  async function handleRevise() {
    setRevising(true);
    setReviseError(null);
    try {
      await api.reviseDesignDna(clientId, reviseNotes.trim() || undefined);
      setReviseNotes('');
      await loadAll();
    } catch (err: any) {
      setReviseError(err.message ?? 'Revizyon isteği başarısız oldu.');
    } finally {
      setRevising(false);
    }
  }

  if (loading) {
    return <div className="empty-state" style={{ animation: 'pulse 1.5s infinite' }}>🧬 Yükleniyor...</div>;
  }

  const canRun = permissions.includes('design_dna:run');
  const canApprove = permissions.includes('design_dna:approve');
  const canRevise = permissions.includes('design_dna:revise');
  const noReferencesYet = references.length === 0;

  const referenceById = new Map(references.map((r) => [r.id, r]));
  const statusInfo = dna ? (STATUS_BADGES[dna.status] ?? { class: 'badge-neutral', label: dna.status }) : null;

  const runButtonTitle = !canRun
    ? 'Bu işlemi çalıştırmak için yetkiniz yok'
    : noReferencesYet
      ? 'Önce en az bir tasarım referansı yükleyin'
      : dna
        ? 'Yeni bir Tasarım DNA versiyonu oluşturur'
        : 'Tasarım DNA analizini başlat';

  // F4 fix: the approve button used to stay enabled (and read as "not
  // approved yet") even on an already-approved DNA version — approve() is
  // idempotent server-side, but that's not obvious from the UI alone.
  const dnaAlreadyApproved = dna?.status === 'approved';
  const approveTitle = dnaAlreadyApproved
    ? 'Bu Tasarım DNA versiyonu zaten onaylandı'
    : 'Bu Tasarım DNA versiyonunu onayla';

  return (
    <div className="animate-fade-in">
      <div className="page-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <h2>🧬 Tasarım DNA</h2>
            <p>
              {dna
                ? `Versiyon ${dna.version} • ${dna.sourceAnalysisCount ?? 0} referansa dayanıyor`
                : 'Yapay zeka ile analiz edilmiş görsel stil profili'}
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            {statusInfo && <span className={`badge ${statusInfo.class}`}>{statusInfo.label}</span>}
            {typeof dna?.confidenceScore === 'number' && (
              <span className="badge badge-neutral">%{Math.round(dna.confidenceScore * 100)} güven</span>
            )}
            <a href={`/clients/${clientId}`} className="btn btn-secondary">← Geri</a>
          </div>
        </div>
      </div>

      {/* ─── Action bar ─────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <button
            className="btn btn-primary"
            disabled={!canRun || noReferencesYet || analyzing}
            title={runButtonTitle}
            onClick={handleAnalyze}
          >
            {analyzing ? '⏳ Analiz ediliyor (biraz sürebilir)...' : dna ? '↻ Yeniden Analiz Et' : 'Analizi Çalıştır'}
          </button>

          {canApprove && dna && (
            <button
              className="btn btn-success"
              disabled={approving || dnaAlreadyApproved}
              onClick={handleApprove}
              title={approveTitle}
            >
              {approving ? '⏳ Onaylanıyor...' : dnaAlreadyApproved ? '✓ Onaylandı' : '✓ Onayla'}
            </button>
          )}

          {canRevise && dna && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <input
                type="text"
                className="form-input"
                placeholder="Revizyon notu (opsiyonel)"
                value={reviseNotes}
                onChange={(e) => setReviseNotes(e.target.value)}
                style={{ width: '260px' }}
                disabled={revising}
              />
              <button
                className="btn btn-secondary"
                disabled={revising}
                onClick={handleRevise}
                title="Revizyon iste"
              >
                {revising ? '⏳ Gönderiliyor...' : '✎ Revizyon İste'}
              </button>
            </div>
          )}

          {!canRun && (
            <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
              Analizi çalıştırmak için yetkiniz yok.
            </span>
          )}
        </div>

        <ErrorNote message={analyzeError} />
        <ErrorNote message={approveError} />
        <ErrorNote message={reviseError} />
        <ErrorNote message={dnaLoadError} />
      </div>

      {/* ─── Empty state: no DNA generated yet ──────────────── */}
      {!dna && !dnaLoadError && (
        <div className="empty-state">
          <div className="icon">🧬</div>
          {noReferencesYet ? (
            <>
              <p>Henüz hiç tasarım referansı yüklenmedi.</p>
              <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem', marginTop: '4px' }}>
                Tasarım DNA analizi çalıştırabilmek için önce en az bir onaylanmış tasarım referansı yükleyin.
              </p>
              <a href={`/clients/${clientId}/references`} className="btn btn-primary" style={{ marginTop: '16px' }}>
                📐 Tasarım Referansı Yükle
              </a>
            </>
          ) : (
            <p>Henüz Tasarım DNA&apos;sı yok. Yukarıdaki butonla analizi başlatın.</p>
          )}
        </div>
      )}

      {/* ─── Aggregated Design DNA ───────────────────────────── */}
      {dna && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(400px, 1fr))', gap: '24px', marginBottom: '32px' }}>
          <div className="card dna-section">
            <h3>🎭 Marka Kişiliği</h3>
            <div className="tag-list">{dna.brandPersonality?.map((p: string) => <span key={p} className="tag tag-accent">{p}</span>)}</div>
          </div>

          <div className="card dna-section">
            <h3>📐 Tercih Edilen Yerleşimler</h3>
            <div className="tag-list">{dna.preferredLayouts?.map((l: string) => <span key={l} className="tag">{l}</span>)}</div>
          </div>

          <div className="card dna-section">
            <h3>👁️ Görsel Kurallar</h3>
            {dna.visualRules?.map((rule: any, i: number) => (
              <div key={i} style={{ padding: '8px 0', borderBottom: '1px solid var(--color-border)', fontSize: '0.9rem' }}>
                <div style={{ color: 'var(--color-text-primary)' }}>{rule.rule}</div>
                <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                  <span className="badge badge-info">{rule.source}</span>
                  <span className="badge badge-neutral">%{Math.round(rule.confidence * 100)} güven</span>
                </div>
              </div>
            ))}
          </div>

          <div className="card dna-section">
            <h3>🔤 Tipografi Kuralları</h3>
            {dna.typographyRules?.map((rule: any, i: number) => (
              <div key={i} style={{ padding: '6px 0', fontSize: '0.9rem', color: 'var(--color-text-secondary)' }}>• {rule.rule}</div>
            ))}
          </div>

          <div className="card dna-section">
            <h3>🎨 Renk Kullanım Kuralları</h3>
            {dna.colorUsageRules?.map((rule: any, i: number) => (
              <div key={i} style={{ padding: '8px 0', borderBottom: '1px solid var(--color-border)' }}>
                <div style={{ fontSize: '0.9rem' }}>{rule.rule}</div>
                {rule.colors && (
                  <div style={{ display: 'flex', gap: '6px', marginTop: '6px' }}>
                    {rule.colors.map((hex: string) => (
                      <div key={hex} className="color-swatch">
                        <div className="color-dot" style={{ backgroundColor: hex }} />
                        <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>{hex}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="card dna-section">
            <h3>🖼️ Görsel İşleme Kuralları</h3>
            {dna.imageTreatmentRules?.length ? dna.imageTreatmentRules.map((rule: any, i: number) => (
              <div key={i} style={{ padding: '6px 0', fontSize: '0.9rem', color: 'var(--color-text-secondary)' }}>
                • {rule.rule}
                {rule.example && <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', marginTop: '2px' }}>{rule.example}</div>}
              </div>
            )) : <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>Kayıtlı kural yok.</p>}
          </div>

          <div className="card dna-section">
            <h3>🎙️ İçerik Tonu</h3>
            <div style={{ marginBottom: '8px' }}>
              <span className="tag tag-accent">{dna.contentTone?.primary}</span>
              {dna.contentTone?.secondary && <span className="tag" style={{ marginLeft: '6px' }}>{dna.contentTone.secondary}</span>}
            </div>
            <div className="tag-list">
              {dna.contentTone?.keywords?.map((k: string) => <span key={k} className="tag">{k}</span>)}
            </div>
          </div>

          <div className="card dna-section">
            <h3>🚫 Kaçınılacaklar Listesi</h3>
            <div className="tag-list">
              {dna.avoidList?.map((item: string) => (
                <span key={item} className="tag" style={{ borderColor: 'rgba(248,113,113,0.3)', color: '#f87171' }}>✕ {item}</span>
              ))}
            </div>
          </div>

          {dna.approvalBias && (
            <div className="card dna-section">
              <h3>⚖️ Onay Eğilimi</h3>
              {dna.approvalBias.preferredFormats?.length > 0 && (
                <>
                  <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', marginBottom: '4px' }}>Tercih edilen formatlar</div>
                  <div className="tag-list" style={{ marginBottom: '8px' }}>
                    {dna.approvalBias.preferredFormats.map((f: string) => <span key={f} className="tag">{formatLabel(f)}</span>)}
                  </div>
                </>
              )}
              {dna.approvalBias.preferredMoods?.length > 0 && (
                <>
                  <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', marginBottom: '4px' }}>Tercih edilen ruh halleri</div>
                  <div className="tag-list" style={{ marginBottom: '8px' }}>
                    {dna.approvalBias.preferredMoods.map((m: string) => <span key={m} className="tag tag-accent">{moodLabel(m)}</span>)}
                  </div>
                </>
              )}
              {dna.approvalBias.rejectionPatterns?.length > 0 && (
                <>
                  <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', marginBottom: '4px' }}>Reddedilme desenleri</div>
                  {dna.approvalBias.rejectionPatterns.map((p: string, i: number) => (
                    <div key={i} style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)', padding: '2px 0' }}>• {p}</div>
                  ))}
                </>
              )}
            </div>
          )}

          {dna.recommendedPromptStyle && (
            <div className="card dna-section">
              <h3>✨ Önerilen Prompt Stili</h3>
              {dna.recommendedPromptStyle.imagePromptPrefix && (
                <div style={{ fontSize: '0.85rem', marginBottom: '6px' }}>
                  <strong>Önek:</strong> {dna.recommendedPromptStyle.imagePromptPrefix}
                </div>
              )}
              {dna.recommendedPromptStyle.imagePromptSuffix && (
                <div style={{ fontSize: '0.85rem', marginBottom: '6px' }}>
                  <strong>Sonek:</strong> {dna.recommendedPromptStyle.imagePromptSuffix}
                </div>
              )}
              {dna.recommendedPromptStyle.styleModifiers?.length > 0 && (
                <div className="tag-list" style={{ marginBottom: '6px' }}>
                  {dna.recommendedPromptStyle.styleModifiers.map((s: string) => <span key={s} className="tag tag-accent">{s}</span>)}
                </div>
              )}
              {dna.recommendedPromptStyle.negativePromptKeywords?.length > 0 && (
                <div className="tag-list">
                  {dna.recommendedPromptStyle.negativePromptKeywords.map((k: string) => (
                    <span key={k} className="tag" style={{ borderColor: 'rgba(248,113,113,0.3)', color: '#f87171' }}>✕ {k}</span>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="card dna-section">
            <h3>📚 Kullanılan Referanslar</h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)', marginBottom: '8px' }}>
              {dna.sourceAnalysisCount ?? 0} referans analiz edildi
            </p>
            <div className="tag-list">
              {dna.referencesUsed?.map((refId: string) => (
                <span key={refId} className="tag">{referenceById.get(refId)?.name ?? refId}</span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ─── Per-reference findings ──────────────────────────── */}
      {dna && (
        <div>
          <h3 style={{ fontFamily: 'Outfit', fontSize: '1.1rem', color: 'var(--color-text-accent)', marginBottom: '16px' }}>
            🔍 Referans Bazlı Bulgular
          </h3>
          {analyses.length === 0 ? (
            <div className="empty-state"><div className="icon">📐</div><p>Referans bazlı analiz bulunamadı.</p></div>
          ) : (
            <div className="card-grid">
              {analyses.map((analysis) => {
                const ref = referenceById.get(analysis.designReferenceId);
                return (
                  <div key={analysis.designReferenceId} className="card dna-section">
                    <div className="card-title">{ref?.name ?? 'Bilinmeyen Referans'}</div>
                    <div className="tag-list" style={{ marginTop: '8px', marginBottom: '10px' }}>
                      {analysis.format && <span className="tag">{analysis.format}</span>}
                      {analysis.aspectRatio && <span className="tag">{analysis.aspectRatio}</span>}
                      {analysis.designCategory && <span className="tag tag-accent">{analysis.designCategory}</span>}
                      {analysis.visualMood && <span className="tag">{analysis.visualMood}</span>}
                      {analysis.layoutPattern && <span className="tag">{analysis.layoutPattern}</span>}
                      {analysis.textDensity && <span className="tag">yoğunluk: {analysis.textDensity}</span>}
                      <span className="badge badge-neutral">%{Math.round((analysis.confidence ?? 0) * 100)} güven</span>
                    </div>

                    {analysis.dominantColors?.length > 0 && (
                      <div style={{ display: 'flex', gap: '6px', marginBottom: '10px', flexWrap: 'wrap' }}>
                        {analysis.dominantColors.map((c: any) => (
                          <div key={c.hex} className="color-swatch">
                            <div className="color-dot" style={{ backgroundColor: c.hex }} />
                            <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>{c.hex} ({Math.round(c.percentage)}%)</span>
                          </div>
                        ))}
                      </div>
                    )}

                    <div style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      {analysis.logoPosition && <div><strong>Logo konumu:</strong> {analysis.logoPosition}</div>}
                      {analysis.imageTreatment && <div><strong>Görsel işleme:</strong> {analysis.imageTreatment}</div>}
                      {analysis.backgroundStyle && <div><strong>Arka plan stili:</strong> {analysis.backgroundStyle}</div>}
                      {analysis.ctaStyle && <div><strong>CTA stili:</strong> {analysis.ctaStyle}</div>}
                      {analysis.typographyHierarchy && (
                        <div>
                          <strong>Tipografi:</strong>{' '}
                          {[
                            analysis.typographyHierarchy.headingStyle,
                            analysis.typographyHierarchy.subheadingStyle,
                            analysis.typographyHierarchy.bodyStyle,
                            analysis.typographyHierarchy.captionStyle,
                          ].filter(Boolean).join(' • ') || '—'}
                        </div>
                      )}
                    </div>

                    {analysis.brandConsistencyNotes && (
                      <p style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)', marginTop: '8px', fontStyle: 'italic' }}>
                        “{analysis.brandConsistencyNotes}”
                      </p>
                    )}

                    {analysis.reusableDesignRules?.length > 0 && (
                      <div style={{ marginTop: '8px' }}>
                        {analysis.reusableDesignRules.map((rule: string, i: number) => (
                          <div key={i} style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', padding: '2px 0' }}>• {rule}</div>
                        ))}
                      </div>
                    )}

                    <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '10px' }}>
                      {new Date(analysis.analyzedAt).toLocaleDateString()}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
