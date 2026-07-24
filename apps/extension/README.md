# RapidApply Browser Helper

This is a clean-room Manifest V3 extension built with WXT. It provides the
secure dedicated-tab handoff, a run-scoped progress channel, a LinkedIn state
observer and search-discovery controller, and a local visual-audit recorder.

## Commands

```bash
pnpm dev:extension
pnpm build:extension
pnpm --filter @rapidapply/extension test
```

`pnpm build:extension` writes a loadable Chrome build to
`apps/extension/.output/chrome-mv3`.

## Intentional boundaries

- The page bridge carries only a one-time launch ticket; profile data and the
  executor capability never cross it.
- Extension execution state uses trusted-context `chrome.storage.local`, not
  third-party page storage, and is schema-validated on recovery.
- The LinkedIn adapter observes state and performs bounded result discovery; it
  does not open applications, click application controls, type, upload, or submit.
- Field values and URL query values are excluded from observation messages.
- Visual evidence stays in extension-local storage and can be exported or
  cleared from the popup.
- Interaction helpers preserve native setters, event dispatch, rerender
  recovery, and bounded verification without enabling a site action policy.

See [LinkedIn observer architecture](../../docs/architecture/linkedin-observer.md)
and [executor ignition and recovery](../../docs/architecture/executor-ignition-and-recovery.md)
and the [legacy audit](../../docs/engineering/legacy-powerapply-linkedin-audit.md).
