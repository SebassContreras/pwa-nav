# 005 - automatic-pwa-provisioning - Design

## Approach

- D1@1 (implements R1, R2, R4): `PwaProvisioner` service interface (`src/browser/provisioner.ts`) isolates on-the-fly PWA resolution and registration behind an anti-corruption layer; given any target HTTP/HTTPS URL, it extracts a deterministic app slug (`appSlugFromUrl`) and automatically prepares standalone PWA configuration on demand without extension messaging or manual user registration. _(standard: W3C Web App Manifest & URL origin partitioning - https://www.w3.org/TR/appmanifest/)_
- D2@1 (implements R1, R3): Profile management delegates directly to the composable `ensureStandaloneProfile(appSlug, { cacheDir })` service, guaranteeing each provisioned domain possesses a dedicated, isolated profile folder (`.agent/apps/<appSlug>/profile`) with BiDi preferences enabled and clean cookies/storage boundaries. _(standard: Firefox user.js profile isolation - https://developer.mozilla.org/en-US/docs/Mozilla/Preferences/A_brief_guide_to_preferences)_
- D3@1 (implements R1, R2, R4): `BidiBackend.open()` integrates transparent on-the-fly provisioning via the injected `PwaProvisioner` when `--launch` is active (or target is unlaunched) and the target is not already listening, auto-spawning the standalone PWA instance with `launchStandaloneApp` and auto-allowing the origin without manual installation blocks. _(judgement, no standard)_

## Deliverables

- `src/browser/provisioner.ts` - `PwaProvisioner` interface, options, and `DefaultPwaProvisioner` implementation (D1, D2).
- Updates to `src/browser/bidi-backend.ts` - integrate provisioner into `open()` workflow for transparent fallback when target is uninstalled/unlaunched (D3).
- Unit tests in `src/browser/test/provisioner.test.ts` (D1, D2).
- Integration tests in `src/browser/test/bidi-backend.test.ts` covering automatic provisioning during navigation (D3).

## Sequencing

D1 and D2 provide the isolated provisioning service and unit verification. D3 wires it into `BidiBackend.open` and end-to-end tool navigation.

## Open questions

None.
