# Claim Integrity: Current UI Summary

## Purpose and product framing

Claim Integrity is a healthcare-claim screening tool. Its interface deliberately separates two questions:

1. **The claim**: deterministic billing rules plus an AI evidence review produce a risk score and a `LOW`, `REVIEW`, or `HIGH` band.
2. **The provider record**: registry evidence is treated as a separate confidence question, so a data gap does not read as an accusation.

The application repeatedly states its guardrail: **screening support, not an accusation**. Appeals are first-class: providers can submit corrected billing information and evidence, and rules and AI results remain visible even when they disagree.

## Verified current state

- Routes: `/` and `/story` serve the guided, scroll-based narrative/demo; `/dashboard` serves the operational dashboard.
- The dashboard currently has no persisted claims, appeals, queued clarification calls, or provider analytics data.
- The dashboard and story route load without browser-console errors.
- The dashboard has a working narrow/mobile layout with no horizontal overflow at 375 px. It changes from a two-column desktop layout to stacked sections.

## Visual language

- **Theme:** warm light mode. Off-white page background, white panels, fine stone-grey borders, near-black type, and muted supporting text.
- **Accent semantics:** green = low/resolved/complete; amber = review/pending/partially resolved; red = high/not resolved; blue is available as a secondary semantic color.
- **Typography:** Avenir Next/system sans serif. The dashboard uses compact operational type; the story route keeps its large editorial display headlines.
- **Components:** 8–13 px rounded corners, restrained hover states, pill badges, soft shadows, and fine dividers. The visual character is serious, clinical, and operational rather than friendly or consumer-oriented.

## Dashboard (`/`)

### Global header

- A 64 px top bar with **Claim Integrity** branding on the left.
- Centered two-button mode switch: **Claims** and **Appeals**.
- Right side: status text, **Provider analytics**, **Queue**, and an **Upload claims** action. Queue and upload open foreground overlays with backdrop and Escape-key dismissal.

### Claims mode (default)

The default view is a focused list surface:

- An `Operations console` heading and the screening-support guardrail.
- A provider overview with Providers, Bills, Flagged, and Rate metrics plus a path to the full provider breakdown.
- An analyzed-claims list with a clear empty state that opens the Upload overlay.
- Upload and call queues remain available from the header rather than consuming a permanent import rail.

When populated, each claim-list row shows claim number, provider name, Rules/AI labels, billed amount, and final risk badge. Selecting it opens a dedicated detail view with a back control and:

- Claim number, provider, and final risk badge.
- Four summary cards: Rules, AI, Final, and Total Billed.
- Claim information cards: patient, diagnosis codes, review amount, and risk score; followed by a clinical note.
- Procedure rows: code, description, service date, units, and dollar amount.
- Evidence findings: number/code, severity badge, source (`RULES`, `AI`, or both), explanatory message, evidence, and optional AI evidence review.
- Clarification-call panel, which can show status, end reason, and transcript. It polls while a call is active.

### Appeals mode

This preserves the dashboard shell and shifts the list surface to appeal intake and review.

- The Upload overlay changes to TXT appeals, with batch/progress/error states and format guidance explaining the `claimNumber` link and corrected billing/evidence.
- The view has a `Right of reply` heading and filter pills for `ALL`, `PENDING`, and `COMPLETED`, each with a count. The current view is empty.

Populated appeal rows show claim number, workflow badge, provider name, and final outcome. The detail view includes:

- Rules, AI, Final, and Workflow outcome cards.
- Appeal reason, note, supporting evidence, diagnosis codes, and optional clinical note.
- Corrected billing/procedure rows.
- Separate deterministic and AI review sections. Result cards keep the original concern, resolution/explanation, supporting appeal evidence, and outcome (`RESOLVED`, `PARTIALLY RESOLVED`, `NOT RESOLVED`, or unavailable) distinct.

### Provider Analytics

- Triggered by a header button; presented in a wide centered modal over a dimmed backdrop.
- Current state says “No provider data yet. Analyze some claims first.”
- With data, it presents six top-line cards: Providers, Total Bills, Review, High, Review / High, and Portfolio Flagged.
- A provider table shows bills by low/review/high band, flagged count, percentages, and a small percentage bar. “Flagged” is explicitly defined as a final `REVIEW` or `HIGH` rating, which is a useful explanatory safeguard.

## Story experience (`/story`)

`/story` is a separate editorial/demo surface rather than a dashboard variant. It opens with a brief “INITIALIZING” transition, then uses a persistent minimal header, scene label, scroll progress indicator, full-height scenes, and animation.

1. **Opening:** a simple folded 3D claim visual beside the headline “TWO AXES. ONE CLAIM.” and the line “A CODING ERROR IS NOT AN ACCUSATION.”
2. **The Two Axes:** two large side-by-side panels, “THE CLAIM” and “THE RECORD,” explaining their separate outputs and the rationale for separation.
3. **Submit a Claim:** drag/drop or file selection; paste support; privacy copy; disabled `RUN BOTH AXES` button until a file is parsed; fixture list for ten demo claims; expandable sample-file format.
4. **The Run:** initially hidden, then reveals the rules, AI, and registry stages as a film-like process.
5. **Verdict:** initially hidden, then exposes routing, two-axis gauges, and claim metadata.
6. **Evidence:** initially hidden, then exposes a dossier-style presentation of findings and explanations.
7. **The Appeal:** initially hidden, with appeal upload, prepared appeals, and result area. It frames appeals as a “right of reply.”
8. **The Ledger:** always available as the final record. It contains summary tiles, a two-axis plot canvas, a claims table, and an appeals table. With no records, its summary values currently render as `undefined` for several metrics, while billed total renders `$0`.

The story ends with the screening-not-accusation statement and a statement that nothing is sent externally without named-person approval.

## Responsive behavior

- Dashboard desktop: a fixed header above a centered list-first workspace; individual claim and appeal records open into dedicated detail views.
- Dashboard mobile: the header wraps compactly, list rows suppress secondary columns, provider metrics condense to two columns, and header overlays fit within the viewport.
- Story: designed primarily as a large, dramatic desktop scroll piece. Its large hero, tiny metadata text, long sections, and animation-led composition are core to the experience.

## Useful improvement starting points

- Decide whether the dashboard and story should feel like one product family or intentionally remain “operations console” versus “pitch/demo site.” Their visual systems are notably different.
- Improve first-use empty states with an example-claim action or clearer next step. The dashboard currently offers only file selection, while the story offers ten runnable fixtures.
- Fix the empty-story Ledger summary values (`undefined`) before using the story route for a polished demo.
- Consider whether the mobile dashboard’s preserved split-pane height is the best review pattern before claim data exists.
- Preserve the clearest product strength during redesign: claim risk, provider evidence, deterministic review, AI evidence review, and appeal outcomes should not collapse into one accusatory score or verdict.

## Relevant implementation files

- `website/index.html`: dashboard structure.
- `website/style.css`: dashboard styling and responsive rules.
- `website/script.js`: uploads, mode switching, list/detail rendering, appeals, calls, and analytics modal.
- `website/story.html`, `website/story.css`, `website/story.js`: narrative experience.
- `README.md`: product framing, routes, demo sequence, and local-run instructions.
