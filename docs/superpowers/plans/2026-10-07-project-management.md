# Project Management incremental implementation plan

**Goal:** Add Project → Manual → Revision to the working application without rebuilding it.
**Architecture:** One Project model/schema/router. Existing manual creation and list logic shared by project routes. Existing revision/storage/publish behavior retained; only new object-key generation receives a project segment. Two new pages reuse ManualForm, Dialog, StatusBadge and a shared manual-list component extracted from the working list.
**Spec:** User's Phase 2 requirements. Baseline evidence: `docs/project-baseline.json`.

## Inspection and decisions

Baseline: 32 backend / 10 frontend tests passed; TypeScript/build/full npm audit passed. Live schema has no projects table; manuals has 1 row, revisions 2 rows. Global unique manual_code and existing publication guard remain. Legacy object bytes/checksums/pointers were captured before migration; previews/downloads pass.

Preserve POST /api/manuals: optional project_id assigns the given project; omitted project_id uses the system LEGACY project. Nested project creation ignores any body project_id and uses the URL. Project update supports code/name/description/status; old keys are never reconstructed or moved. Project lists use one grouped count query. New project codes use the same safe character rule as new manual codes. Existing data reads remain permissive.

## Tasks

1. [x] Database: explicit `002_projects.sql`; projects schema, nullable project_id, LEGACY backfill, NOT NULL, FK/index. Apply and reapply; compare all existing manual/revision metadata and file bytes. Run unchanged baseline backend tests before model integration.
2. [x] Backend: failing project tests; Project model/schema/router, shared manual list/create, optional project filter and project identity responses. Test CRUD/count/filter/isolation/global duplicate/missing/project route authority. Preserve original revision tests; run suite.
3. [x] Storage: failing tests for new project prefixes and stored legacy keys. Reuse path-segment safety; change only new upload key generation. Adjust old new-upload path assertions to include LEGACY, retain all business assertions. Run suite.
4. [x] Frontend: failing project workflow tests; shared request function, project API/types/form, Projects/ProjectDetail pages. Extract existing filter/table into reusable ManualsList; retain /manuals behavior and tests. Project-context ManualForm, breadcrumb/link and upload context. Run Vitest/typecheck/build.
5. [x] Verification: full suites and full npm audit; live HTTP Project/manual/two-revision flow with labelled fixture, old snapshot comparison and signed retrieval, browser smoke. Independent final review and targeted regression fixes. Update README and Phase 2 report with exact migration, files and actual risks.

No automatic migration, no revision project_id, no destructive APIs, no MinIO file changes, no auth expansion, no dependency additions. User explicitly requests continuous execution after inspection. Existing code was read before edits; execute inline and request one final reviewer through the applicable review skill.
