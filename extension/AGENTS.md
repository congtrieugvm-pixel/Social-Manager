# Extension release workflow

The user requested that extension updates be packaged and published to their
existing Social Manager website automatically, with a download in **Tiện ích**.

- Keep `manifest.json` as the release version source. Bump its version for a new
  extension release and keep `package.json` in sync; popup reads the runtime version.
- `app`'s `prebuild` and `predev` hooks call `scripts/package.cjs --web`. It validates
  the package and generates the ZIP assets and page metadata. Never manually edit
  generated downloads or `app/src/generated/extension-release.json`.
- When implementing a requested extension update, include publication through the
  existing GitHub `main` → Cloudflare deployment unless the user says otherwise.
  Stage only task-owned files, verify deployment and the live ZIP version/hash.
  Do not stop at producing a local ZIP. A review-only request is not publication.
- The ZIP is public; keep its explicit file allowlist. Never include credentials,
  browser profiles, app databases, local environment files, or tool configuration.
- Do not claim unpacked extensions auto-update in the browser. Only the website
  download is automatic; users replace their extracted files and click Reload.
- Document the actual test coverage. The initial implementation was tested with
  DOM/Chrome API fixtures, not an authenticated real TikTok Studio account.
- Version 1.0.2 uses the **Everyone** privacy filter as the work queue. Recover
  missing post-menu options by reapplying that filter and keep retrying with a
  delay, honoring Stop. Only report completion after reapplying Everyone,
  returning to page one, and seeing a stable explicit empty state. A disabled
  Next button or no new row IDs is insufficient. Never confuse filter checkboxes
  with per-post privacy options, and re-read rows after every mutation.
