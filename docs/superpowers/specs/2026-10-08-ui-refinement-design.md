# Manual Management: UI refinement plan (design spec)

Status: **Approved (2026-10-08)**.
Date: 2026-10-08. Path: architectural, split into five sub-projects (A to E).
Each sub-project gets its own plan in `docs/superpowers/plans/` after this spec is approved.

## 1. Understanding (please correct)

- Users read **English** (decision of 2026-10-08). The UI stays English. Manual titles and
  descriptions are user data and may contain Thai.
- Direction is the existing navy and ivory "corporate 3D" interface
  (`docs/ui-redesign-2026-10-08.md`). This plan **refines** it. It does not replace it.
- The chosen typeface is **Fitness** (Intermedia Studio) from `Downloads/fitness.zip`.
- Backend is out of scope. Existing tests in `frontend/src/test` must keep passing.
- Success: pages look and behave as one system, pass WCAG 2.2 AA on the issues found in the
  review, load faster, and the Fitness font gives the product a recognisable voice without
  hurting readability.

## 2. What the zip actually contains (verified)

`fitness.zip` holds only `Fitness.otf`, `Fitness.ttf`, `Fitness.woff`. It is **a font, not a
template or UI kit**, so there is no layout, colour or component set to copy from it.
Inspection of `Fitness.ttf` (fontTools plus a rendered specimen):

| Property | Finding | Consequence |
|---|---|---|
| Style | Hairline, hand-drawn, condensed, single weight (400) | Needs large sizes. No bold. |
| Case | **Capitals only.** `a` and `A` map to the same glyph | Mixed-case text shows as capitals. |
| Thai | 0 glyphs | Thai user data would fall back to another font. |
| Glyph set | 114 glyphs. Missing `·` `…` `—` `–` `←` `→` `×` | The UI uses these often. Static headings must avoid them. |
| Kerning | None (no GPOS or kern table) | Spacing is uneven. Tracking must be tuned by eye. |
| Digits | Present, but the `1` and `7` forms are hard to tell apart at small sizes | Unsafe for codes and revision numbers. |
| Licence | Created with Fontself Maker. **No licence text in the zip.** | Must be confirmed before shipping (internal company use is commercial use). |

Because capitals-only hides case, it must never render values that are **case-sensitive**.
Project codes are explicitly case-sensitive in `ProjectForm`, so `prj-a` and `PRJ-A` would look
identical.

## 3. Decision: where Fitness is used

Rule: **system voice uses Fitness. Data voice uses the UI font.**

Use Fitness (min 28px, navy or white on navy, tracking tuned) for:
- the sidebar and login wordmark ("Manual Management")
- static page titles on list pages (Projects, Users, Change Password) and the login headline
- the empty-state headline

Never use Fitness for: buttons, labels, tables, badges, body text, project or manual names,
codes, revision numbers, dates, dialogs, or anything a user typed. Entity pages
(Project Detail, Manual Detail) keep the UI font for their `h1`, because that text is data.

Implementation constraints:
- One token: `--font-display`. Switching or removing the font is a one-line change.
- Self-host `woff2` plus `woff`, subset to the used glyphs, `font-display: swap`,
  preload only the display file. Budget: under 20 KB.
- Fallback stack: `"Fitness", "Segoe UI", "Noto Sans Thai", Tahoma, sans-serif`.
  Heading `text-transform: none` (the font already capitalises).
- Add `-webkit-text-stroke` of about 0.4px only if the hairline strokes fail the visual check.
- **Gate:** if the licence cannot be confirmed, ship with the token pointing at the UI font and
  keep the font files out of the build.

Risk to accept knowingly: hairline display type on a document-control tool can read as
playful. The token design lets us revert without touching components.

## 4. Sub-projects

### A. Accessibility and colour fixes (small, first)
- Control borders to at least 3:1 (`--border-control`), currently 1.48:1.
- Approve and reject textareas: remove `focus:outline-hidden`, reuse `.field` styling.
- Add `.btn-danger` and `.btn-success` (matching border, hover, focus). Replace the five
  `btn-primary bg-rose/teal` overrides and the ad-hoc Remove Member button.
- Text colours: review-history dates to `slate-500`, required asterisk to `red-700`.
- `btn-small` gets a 44px hit area on touch screens (padding or `::after`), visual size unchanged.
- Add `aria-label` with the file name to every Preview and Download button.

### B. Performance (small)
- Convert `document-folder.png` (1.89 MB) to WebP/AVIF at 200 and 480 px with `srcset`
  (target under 40 KB each). Keep the existing asset as the source.
- Replace "Loading…" text with skeletons that reserve layout; add `aria-busy`.
- Lazy-load route components (`React.lazy`) for Users and Manual Detail.

### C. Typography (small to medium)
- `lang="en"` stays. A tiny `<UserText>` helper sets `lang="th"` on user data that contains
  Thai (`/[฀-๿]/`), so screen readers and line breaking behave.
- Thai-safe rules for user data only: `line-height` at least 1.4, `letter-spacing: 0`,
  `word-break: auto-phrase`.
- Add the Fitness `@font-face` and `--font-display`, applied per section 3.
- Load Noto Sans Thai (subset) so Thai titles render the same on every machine.

### D. Design system (medium)
- Semantic tokens: `--color-primary`, `--color-danger`, `--color-success`, `--text-muted`,
  `--border-control`, `--border-subtle`. Stop overriding Tailwind base colours in `@theme`.
- Shared components: `Button` (primary, secondary, danger, success, small), `Badge`
  (status and role in one style), `Notice` (dismissible, auto-clear, sticky when scrolled),
  `PageHeader`.
- Remove duplicates: one breadcrumb (in the shell header, full path), one back link, user
  info once on desktop, one icon style (`Icon` only, no `+` or `←` characters).
- Differentiate APPROVED from PUBLISHED (hue plus icon).
- Dialog: initial focus on Cancel for destructive actions; restore focus to the trigger.
- Reduce shadow and gradient variants to one elevation scale.

### E. Flow improvements (large, last)
- Primary "Open document" button on Manual Detail for readers (viewers).
- Global search in the header (manual code or title across projects).
- Revision workflow stepper: Draft, In Review, Approved, Published, with who acts next.
- "Waiting for review" count in the sidebar for reviewers (`role="status"` phrase).
- Upload: next revision number suggested, real progress and cancel, confirm before closing a
  dirty form, keep the selected file when the type changes (or warn).
- Explain hidden actions ("Only an Owner can publish") instead of silently removing buttons.
- Tablet (768 to 1023 px): collapse the sidebar to icons.

## 5. Order and dependencies

0. **Baseline.** The previous redesign was never validated. Before any change: run `vitest`,
   `tsc`, `vite build`, and capture screenshots of every page at 375, 768 and 1280 px.
   Fix or record pre-existing failures so later regressions are attributable.
1. A, 2. B, 3. C (needs the licence answer for the font), 4. D, 5. E.
D comes before E so E uses shared components. Tests asserting `aria-label` text must be
updated in the same commit as the component that changes them.

## 6. Testing and verification

- Unit and component tests stay green after each sub-project (`frontend/src/test`).
- New tests: contrast tokens (computed ratios), `UserText` language detection, `Notice`
  dismiss, dialog initial focus, stepper states per role.
- Visual: before and after screenshots per sub-project. Check Fitness at the real sizes.
- Accessibility: keyboard-only pass of login, create project, upload, approve, publish.
- Performance: record image bytes and bundle size before and after B.

## 7. Out of scope

Backend or API changes, translating the UI, dark mode, a new colour direction, replacing the
3D folder artwork, a full i18n framework.

## 8. Resolved questions & decisions

1. **Fitness Licence**: Confirmed for internal commercial use. Proceed with incorporating Fitness (.woff2) for large system headings (min 28px) in Phase C.
2. **Fitness Weight / Readability**: If rendered hairline strokes look too thin, first attempt fine-tuning stroke/weight (e.g. `-webkit-text-stroke: 0.4px`). If still unreadable or visually unbalanced, fallback to UI font.
3. **Review Queue Scope**: Implement as a badge counter in the sidebar for reviewers to keep the interface concise.
