# RF-ISSUES — deferred from the DNA palette fix run

Deferred during the Same Page Meeting (round 1). Real, but not this cycle.

- **[med] Post-render flat-color QA stage.** `render-quality.ts` runs BEFORE the render and
  has no pixel access, so a "flat_color_output" warning cannot live there. Add a separate
  post-render QA step that samples the rendered image bytes (after the adapter returns) and
  raises a low-color-variance warning. (Same Page finding 11.)
- **[med] Async palette extraction with status + re-extract.** Extraction currently runs
  synchronously inside the upload (asset is persisted first; extraction is timeout-bounded
  and best-effort). A fuller design persists the upload immediately, runs extraction as a
  bounded background job with an explicit `pending`/`ok`/`failed` status, and offers a
  "re-extract" action in the UI. (Same Page finding 8, full version.)
- **[low] Commit hygiene.** The pre-Codex baseline (`01ebe47`) bundled unrelated but
  already-green work (FileDropzone drag-drop/preview, TURKISH_OUTPUT_DIRECTIVE). Split the
  final commits by concern (upload-UX / Turkish-output / DNA-palette) before deploy.
  (Same Page finding 15.)
