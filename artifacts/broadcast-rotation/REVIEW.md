# Broadcast rotation — 2026-11-17

Baseline: `3f6cd42`. The earlier side-camera fix inadvertently made Broadcast a single fixed view. This change keeps the corrected tracking rigs and restores a deliberate shot rotation:

Side (8 s) → Vector T-cam (7 s) → Aerial (9 s) → Chaos driver-eye (7 s) → Chase (8 s) → Chaos T-cam (7 s) → Vector driver-eye (7 s) → Aerial (9 s), then repeat.

These are real seconds, independent of the accelerated race clock. Each shot holds its own camera, lens and driver. Overtake and near-miss events do not interrupt the hold. The director resumes with one cut after a long background pause instead of catching up through rapid cuts. Selecting Broadcast restarts at Side. Selecting any individual camera holds it; a dedicated Side button now exposes the stabilised side-follow view.

The effective shot drives the full existing onboard path, including driver visibility, rear-view mirrors and visor option; this is not an external camera moved into the cockpit. Switching shots resets tracking damping so no stale rig position leaks into the new view. No models, physics, providers, invitations or circuit geometry were changed.

Verification adds unit coverage for the complete cycle, repeat, reset and background pause, plus a headed browser cycle on each circuit. Browser fixtures inject an overtake every second to ensure event spam cannot shorten a shot, capture every distinct view, verify a complete cycle and check manual hold/re-entry. The existing side-motion tests now explicitly select Side and retain the same motion thresholds. The first browser attempt failed on an ambiguous test selector matching the viewport and button; selectors were corrected to target buttons. The production implementation did not change in response.

Visual review: I inspected both seven-view contact sheets and the full-size Monza T-cam/driver-eye captures. T-cams retain the helmet crown and halo framing; driver-eye shots retain the wheel, readable dash, mirrors and view of the rival ahead. Side/chase/aerial use the existing stabilised framing. All views show the selected Broadcast button while the actual shot caption changes. The measured holds were 7.98–8.02 seconds for Side/Chase, 7.00–7.02 for onboards and 9.00–9.02 for Aerial. Every cycle returned to Side. Both manual-hold and Broadcast re-entry checks passed.

This uses deliberate hard broadcast cuts, not crossfades. The rotation is fixed rather than an event-aware TV director; holding the selected view avoids the earlier rapid battle-triggered interruptions. Existing model/material limitations remain unchanged.
