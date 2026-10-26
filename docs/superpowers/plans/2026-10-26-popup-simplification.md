# Simplified popup implementation plan

> Execute inline using test-driven-development. User approved the proposed single-editor layout with scope selection and disabling unsupported pages. Existing isolated branch/worktree is retained; no merge/push.

**Goal:** Keep popup focused on the current page; keep global rule lists in Options.
**Architecture:** One editor dispatches existing site/tab message actions. Background determines page support using URL protocol and restricted Chrome Web Store URLs. Status includes its tab ID so host and target cannot come from separate active-tab queries.
**Tech Stack:** Existing vanilla JS/HTML/CSS, MV3, dependency-free Node tests, isolated Chrome probe.
**Spec:** User-approved proposal in this conversation: status + one mode + tab/site scope + one apply action; rename Open Settings to All rules and exclusions; unsupported pages display an explanation and disable rule actions. Early injection is out of scope.

## Decisions

- Preserve English UI to match the rest of the extension.
- Default scope: existing tab override if present, otherwise site. Switching scope restores that scope's saved rule and preserves unsaved drafts independently.
- Keep inherit/auto/disable/fixed semantics and rule priorities unchanged. Warn when exclusions/whitelist or a tab override prevent a site rule from taking effect.
- One Apply and reload button reloads the current tab only after a successful save, for either scope. Other tabs on the site still need their own reload.
- Remove quick Add Site to Exclusions from popup: exclusions/whitelist live in Options; Do not spoof remains in the quick editor.
- Supported page requires http/https + hostname and must not be a Chrome Web Store page. Other schemes/file/about/service pages are disabled. Do not create locks for unsupported status requests.
- Existing get-settings, set-site-rule, set-tab-rule storage models stay intact. Status adds supported:boolean and tabId:number|null. Reject tab saves on unsupported pages in background, not just UI.

## Review focus

- Options/extension/chrome/about/file/store pages must not expose bogus effective timezone or create session locks.
- Explicit saved tab and site rules must not be mixed when switching scope.
- Failed saves and transport errors preserve form values and restore correct disabled state.
- Page changes during async save must not retarget a write or reload to a different tab.
- Scope warnings must respect exclusions/whitelist/tab overrides without changing priorities.

## Task 1: Page support and coherent status

Files: `background.js`, `tests/helpers/background-context.cjs`, `tests/rules.test.cjs`.

- [x] Add tests for supported http/https vs extension/chrome/about/file/data/Web Store URLs, no lock on unsupported status, and rejected tab save there.
- [x] Run `node --test tests/rules.test.cjs`; observe new regressions fail (9 RED).
- [x] Update getHostname to enforce supported URLs, include supported/tabId in getTabStatus (including empty result), validate tab-rule targets via chrome.tabs.get.
- [x] Run full suite (147/147); old tests retain behavior for supported hosts. Commit task files (`282a5af`).

## Task 2: Single popup editor

Files: `popup.js`, `popup.html`, `popup.css`, `tests/helpers/ui-context.cjs`, `tests/popup.test.cjs`.

- [x] Add behavioral tests for one editor, both scopes, independent drafts, failed saves, unsupported/loading/error disabled state and available Refresh/Options.
- [x] Run `node --test tests/popup.test.cjs`; new editor tests fail before implementation (9 RED).
- [x] Replace duplicate forms with rule-scope/rule-mode/rule-timezone/apply-rule-btn. Keep current status and IP metadata; use status tabId directly. Apply reloads only the captured tab after successful save. Unsupported pages show Not available instead of a chosen timezone.
- [x] Add associated labels, concise scope/precedence hint and readable disabled state. Rename Options link. Preserve settings data and Options lists.
- [x] Run full suite (157/157); commit task files (`1651d41`).

## Task 3: Chrome verification and docs

Files: `tests/browser-smoke.cjs`, `README.md`, this plan.

- [x] Adapt real-browser UI actions to the single form; verify exactly one Apply editor, scope switch and save/reload, normal and unsupported extension/chrome pages, Refresh/Options available (Chrome 156; no page errors; preview visually inspected).
- [x] Run `node tests/browser-smoke.cjs`, full `node --test tests/*.test.cjs`, syntax and diff checks (final: 159/159, Chrome 156 passed, zero page errors).
- [x] Update README popup description, commit, obtain one read-only final code review and fix concrete important findings with regression tests.
- [x] Report results and any unverified restrictions. Keep master and original user changes untouched.

## Execution record

- Unsupported-page regressions: 9 RED → GREEN; one source of tab ID/host in status, no unsupported locks, background rejects unsupported tab writes.
- Single-editor regressions: 9 RED → GREEN; saved scopes and unsaved drafts independent, controls disabled while unavailable/busy, failed save does not reload, active-tab change does not retarget captured write/reload.
- Chrome 156 verified one form (old forms and exclusion action absent), unsupported own extension page and chrome://settings, both scope saves and automatic reload, inherited rules, existing injection/rule/lock scenarios. Preview visually inspected.
- Independent read-only review of `5b2d99c..3582d32`: one Important finding, no Critical/Minor. Applying one scope reset the unsaved draft of the other. Added tests in both directions (2 RED), reconciled only saved scope after applying. Final suite: 159/159 GREEN and repeated Chrome smoke GREEN. No second review was dispatched.
- Runtime defaults, storage schema, precedence and injection architecture were not changed. Global exclusions/whitelist remain Options-only. No merge or push.
- Browser integration uses isolated headless pages, not an installed toolbar popup on a live user profile; Chrome's actual toolbar size/scroll behavior and live Google/VPN flows are not claimed as verified here.
