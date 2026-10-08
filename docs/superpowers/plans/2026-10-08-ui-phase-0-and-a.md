# UI Refinement Implementation Plan: Phase 0 (Baseline) & Phase A (Accessibility & Color)

> **For agentic workers:** Use superpowers:executing-plans to implement task-by-task.

**Goal:** Establish a verified baseline for the frontend, then fix WCAG 2.2 AA accessibility and color contrast issues without breaking existing behavior or tests.

**Architecture:** Semantic CSS utility tokens in `frontend/src/styles.css`, consistent button variants (`.btn-danger`, `.btn-success`), accessible form control borders (3:1 contrast), and explicit accessible naming (`aria-label`) on interactive preview/download controls.

**Spec Reference:** `docs/superpowers/specs/2026-10-08-ui-refinement-design.md` (Approved 2026-10-08).

---

## Phase 0: Baseline Measurement & Verification

### Task 0.1: Run Test Suite and Build Baseline
- [x] Run `npx vitest run` in `frontend/` to document pre-existing test results (48 tests passing after removing redundant role=status on count element).
- [x] Run `npx tsc --noEmit` in `frontend/` to check type safety (Passed).
- [x] Run `npm run build` in `frontend/` to verify asset bundling and bundle size baseline (Passed, 335 kB JS / 35 kB CSS).
- [x] Document any baseline errors or warnings.

---

## Phase A: Accessibility & Color Fixes

### Task A.1: Form Controls Contrast & Focus State
- **Files:** `frontend/src/styles.css`, `frontend/src/pages/ManualDetailPage.tsx`, `frontend/src/components/ProjectForm.tsx`
- [x] Ensure `--border-control` meets 3:1 contrast ratio against background (4.58:1 with `#62778f` / `#64748b`).
- [x] Fix approve/reject modal and inline textareas: remove `focus:outline-hidden` overrides, apply unified `.field` styling with standard focus ring.
- [x] Set required field asterisks to accessible `red-700` (`#b91c1c` / `--color-danger`).

### Task A.2: Standardize Button Variants (`.btn-danger`, `.btn-success`)
- **Files:** `frontend/src/styles.css`, `frontend/src/pages/ProjectDetailPage.tsx`, `frontend/src/pages/ManualDetailPage.tsx`, `frontend/src/pages/UsersPage.tsx`, `frontend/src/pages/ProjectsPage.tsx`, `frontend/src/components/RevisionHistory.tsx`
- [x] Define standard `.btn-danger` and `.btn-success` in `frontend/src/styles.css` matching design system border, shadow, hover, and focus tokens.
- [x] Replace ad-hoc inline classes (`bg-rose-*`, `bg-teal-*`) and "Remove Member" ad-hoc buttons with standardized classes.
- [x] Ensure `.btn-small` maintains a minimum 44px touch target on mobile/touch viewports while keeping compact desktop visual styling.

### Task A.3: Accessible Labeling & Date Text Contrast
- **Files:** `frontend/src/components/PdfPreview.tsx`, `frontend/src/components/RevisionFiles.tsx`, `frontend/src/components/RevisionHistory.tsx`, `frontend/src/pages/ManualDetailPage.tsx`, `frontend/src/pages/ProjectDetailPage.tsx`
- [x] Add explicit `aria-label` including the document/file title for all Preview and Download buttons.
- [x] Update review history timestamp and metadata text colors to high-contrast `slate-500` / accessible text tokens.

### Task A.4: Verification & Regression Check
- [x] Run `npx vitest run` to ensure all existing and updated component tests pass (49/49 passed).
- [x] Run `npx tsc --noEmit` and `npm run build` to confirm zero type errors and clean production build.
- [x] Verify keyboard tab navigation and focus visibility across modals, forms, and tables.
