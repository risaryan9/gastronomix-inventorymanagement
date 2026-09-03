# 0008. No `window.alert` or `window.confirm` — toasts and one dialog

Date: 2026-09-03 (recorded); decided 2026-06
Status: Accepted

## Context

Three admin sections asked "Delete operator?" through `window.confirm`, and a
dozen call sites reported failure through `window.alert` — popups that freeze
the page, cannot be styled, and look like the browser rather than the app.

Worse, **only failure ever spoke.** An action that worked closed a modal and
refreshed a list, leaving the user to infer success from the absence of a popup.

## Decision

Two providers sit above the router, so any screen can raise either without
threading props:

- `useToast()` → `success` / `error` / `warning` / `info`
- `useConfirm()` → returns a promise, so call sites read almost as they did:
  `if (!(await confirm({…}))) return`

**There are no `window.confirm` or `alert` calls left anywhere in `src`.** Keep
it that way.

The conventions that came with it:

- **Every action that can fail also says when it worked, by name.** "Operator
  deleted — Ana has been removed", not a bare tick.
- **Errors carry the reason** from the caught error, not a generic retry line,
  and they stay until dismissed. Everything else times out — a message you must
  dismiss to keep working is its own annoyance.
- **Tone is never colour alone.** Each toast has an icon and a written title.
  Errors render `role="alert"`; the rest `role="status"`, so a screen reader is
  not interrupted by routine success.
- **Destructive prompts open with Cancel focused**, so a stray Enter backs out,
  and their wording says what cannot be undone. Deleting an operator is
  permanent; deactivating a recipe is not — `window.confirm`'s single line could
  not distinguish them, and the prompts now do.

## Consequences

- Two implementation details that will look like noise and are not: the contexts
  live in their own files because a file exporting both a component and a hook
  loses Fast Refresh; and the confirm promise's resolver is held in a **ref, not
  state**, because React may run a state updater twice in development and
  settling a promise inside one is a side effect that has no business there.

## Where it lives

- `frontend/src/components/ui/ToastProvider.jsx`, `components/ui/ConfirmProvider.jsx`
- `frontend/src/context/toastContext.js`, `context/confirmContext.js`
- `docs/ADMIN_DASHBOARD_UX_IMPROVEMENTS.md` (item 3)
- Commit `e485239`
