'use client';

import { useEffect, useRef, useState } from 'react';

interface FileDropzoneProps {
  value: File | null;
  onChange: (file: File | null) => void;
  /** Comma-separated accept list forwarded to the hidden input (e.g. "image/png,image/jpeg"). */
  accept?: string;
  disabled?: boolean;
  /** Small helper line under the prompt (e.g. "PNG, JPG, WEBP, PDF"). */
  hint?: string;
}

/**
 * Shared file picker with drag-and-drop and a live pre-upload preview.
 *
 * Controlled: the parent owns the selected `File` (so its existing FormData
 * upload flow is untouched) and this component only reports selection changes.
 * Images get a thumbnail via a local object URL (revoked on change/unmount);
 * non-images show name + size. Click or keyboard (Enter/Space) opens the native
 * picker; dropping a file selects it. Styled with the dashboard's CSS tokens.
 */
export function FileDropzone({ value, onChange, accept, disabled, hint }: FileDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // Build an object URL for image previews and revoke it when the file changes
  // or the component unmounts (same cleanup discipline as the render-job pollers).
  useEffect(() => {
    if (value && value.type.startsWith('image/')) {
      const url = URL.createObjectURL(value);
      setPreviewUrl(url);
      return () => URL.revokeObjectURL(url);
    }
    setPreviewUrl(null);
  }, [value]);

  function selectFrom(files: FileList | null) {
    const f = files?.[0];
    if (f) onChange(f);
  }

  function openPicker() {
    if (!disabled) inputRef.current?.click();
  }

  return (
    <div>
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled}
        onClick={openPicker}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && !disabled) {
            e.preventDefault();
            openPicker();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (!disabled) selectFrom(e.dataTransfer.files);
        }}
        style={{
          border: `1.5px dashed ${dragOver ? 'var(--color-border-accent)' : 'var(--color-border)'}`,
          borderRadius: 'var(--radius-md)',
          background: dragOver ? 'var(--color-bg-glass-hover)' : 'var(--color-bg-glass)',
          padding: value ? '12px' : '26px 16px',
          cursor: disabled ? 'not-allowed' : 'pointer',
          transition: 'all var(--transition-fast)',
          textAlign: 'center',
          opacity: disabled ? 0.6 : 1,
          outlineOffset: '2px',
        }}
      >
        {value ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', textAlign: 'left' }}>
            {previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- local object URL preview, not a remote source
              <img
                src={previewUrl}
                alt={value.name}
                style={{ width: '56px', height: '56px', objectFit: 'cover', borderRadius: 'var(--radius-sm)', flex: 'none', background: 'var(--color-bg-glass)' }}
              />
            ) : (
              <div style={{ width: '56px', height: '56px', display: 'grid', placeItems: 'center', borderRadius: 'var(--radius-sm)', background: 'var(--color-bg-glass)', fontSize: '1.5rem', flex: 'none' }}>
                📄
              </div>
            )}
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value.name}</div>
              <div style={{ color: 'var(--color-text-secondary)', fontSize: '0.8rem' }}>{formatBytes(value.size)}</div>
            </div>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={disabled}
              style={{ flex: 'none' }}
              onClick={(e) => {
                e.stopPropagation();
                onChange(null);
                if (inputRef.current) inputRef.current.value = '';
              }}
            >
              Kaldır
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'center' }}>
            <div style={{ fontSize: '1.7rem', lineHeight: 1 }} aria-hidden="true">⬆️</div>
            <div style={{ fontWeight: 600 }}>{dragOver ? 'Dosyayı buraya bırak' : 'Dosyayı sürükleyip bırak ya da seçmek için tıkla'}</div>
            {hint && <div style={{ color: 'var(--color-text-secondary)', fontSize: '0.8rem' }}>{hint}</div>}
          </div>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        onChange={(e) => selectFrom(e.target.files)}
        style={{ display: 'none' }}
      />
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
