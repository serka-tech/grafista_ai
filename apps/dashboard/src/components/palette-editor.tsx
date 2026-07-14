'use client';

import { useState } from 'react';
import { api } from '@/lib/api';

export interface PaletteColor {
  hex: string;
  name?: string;
  role: string;
}

const ROLES: Array<{ value: string; label: string }> = [
  { value: 'primary', label: 'Birincil' },
  { value: 'secondary', label: 'İkincil' },
  { value: 'accent', label: 'Vurgu' },
  { value: 'background', label: 'Arka plan' },
  { value: 'text', label: 'Metin' },
  { value: 'other', label: 'Diğer' },
];

const HEX_RE = /^#[0-9A-Fa-f]{6}$/;

/**
 * Editable brand palette for a color_palette asset. Colors are auto-extracted from
 * the uploaded kartela by the backend (asset.metadata.palette); this lets the user
 * review and correct them, then saves via PATCH. The saved palette is what the
 * visual pipeline reads, so getting it right here fixes the "flat color" output.
 */
export function PaletteEditor({
  clientId,
  assetId,
  initial,
  onSaved,
}: {
  clientId: string;
  assetId: string;
  initial: PaletteColor[];
  onSaved?: (palette: PaletteColor[]) => void;
}) {
  const [colors, setColors] = useState<PaletteColor[]>(initial ?? []);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState('');

  function update(i: number, patch: Partial<PaletteColor>) {
    setColors((cs) => cs.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
    setStatus('idle');
  }
  function remove(i: number) {
    setColors((cs) => cs.filter((_, idx) => idx !== i));
    setStatus('idle');
  }
  function add() {
    setColors((cs) => [...cs, { hex: '#000000', role: 'other', name: '' }]);
    setStatus('idle');
  }

  async function save() {
    const bad = colors.find((c) => !HEX_RE.test(c.hex));
    if (bad) {
      setStatus('error');
      setError('Tüm renkler #RRGGBB formatında olmalı (ör. #1A2B3C).');
      return;
    }
    setStatus('saving');
    setError('');
    try {
      const payload = colors.map((c) => ({
        hex: c.hex.toUpperCase(),
        role: c.role,
        ...(c.name ? { name: c.name } : {}),
      }));
      const res = await api.updateBrandAssetPalette(clientId, assetId, payload);
      setStatus('saved');
      onSaved?.(res.data?.metadata?.palette ?? payload);
    } catch (e: any) {
      setStatus('error');
      setError(e.message ?? 'Palet kaydedilemedi.');
    }
  }

  return (
    <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <div style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)' }}>
        Marka renkleri {initial?.length ? '(AI kartelayı okudu, gözden geçirip düzelt)' : '(elle ekle)'}
      </div>
      {colors.length === 0 && (
        <div style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)' }}>
          Kartelanın renkleri okunamadı. Aşağıdan elle ekleyebilirsin.
        </div>
      )}
      {colors.map((c, i) => (
        <div key={i} style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <input
            type="color"
            value={HEX_RE.test(c.hex) ? c.hex : '#000000'}
            onChange={(e) => update(i, { hex: e.target.value })}
            aria-label="Renk seç"
            style={{ width: '32px', height: '32px', padding: 0, border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', background: 'transparent', flex: 'none', cursor: 'pointer' }}
          />
          <input
            type="text"
            value={c.hex}
            onChange={(e) => update(i, { hex: e.target.value })}
            aria-label="Hex kodu"
            style={{ width: '92px' }}
          />
          <select value={c.role} onChange={(e) => update(i, { role: e.target.value })} aria-label="Rol" style={{ flex: 1, minWidth: '90px' }}>
            {ROLES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={c.name ?? ''}
            onChange={(e) => update(i, { name: e.target.value })}
            placeholder="İsim"
            aria-label="Renk ismi"
            style={{ width: '96px' }}
          />
          <button type="button" className="btn btn-secondary" onClick={() => remove(i)} aria-label="Rengi kaldır" style={{ flex: 'none' }}>
            ×
          </button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: '8px' }}>
        <button type="button" className="btn btn-secondary" onClick={add}>
          + Renk Ekle
        </button>
        <button type="button" className="btn btn-primary" onClick={save} disabled={status === 'saving'}>
          {status === 'saving' ? 'Kaydediliyor...' : status === 'saved' ? 'Kaydedildi ✓' : 'Paleti Kaydet'}
        </button>
      </div>
      {status === 'error' && (
        <p style={{ color: 'var(--color-danger, #e05252)', fontSize: '0.8rem', margin: 0 }}>{error}</p>
      )}
    </div>
  );
}
