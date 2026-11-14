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
- From version 1.0.4 (latest user correction), select **Everyone** and Apply
  BEFORE any post mutation. Keep Friends/private posts out of the queue.
  On per-post menu/dialog/verification errors, dismiss with Escape or a scoped
  Cancel/Close control, defer that ID, scroll down and try other posts. Do not
  refilter after every failed post. Retry deferred IDs after reaching the end.
  Never dismiss dialogs by deleting their DOM or by clicking Save during recovery.
  If a dialog cannot close, do not mutate posts behind it or report success.
  Honor Stop during all recovery/scroll/backoff steps. Only report completion after reapplying Everyone,
  returning to page one, and seeing a stable explicit empty state. A disabled
  Next button or no new row IDs is insufficient. Never confuse filter checkboxes
  with per-post privacy options, and re-read rows after every mutation.
- Support custom CSS/SVG filter checkboxes as well as native/ARIA controls.
  Scope Clear/Apply to a panel containing all three privacy labels; verify the
  cleared decoration, selection changes and persisted selection after Apply.
  Retry temporary filter errors with backoff and Stop; never equate detection
  failure with an empty list. Test filter-before-edit order, lazy rows, and dialog
  failures after several successes. `npm run test:browser` uses a separate
  Chromium fixture with blocked external networking, not the user's Chrome.
