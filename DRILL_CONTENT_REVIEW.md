# Drill content review

Status: full review deferred by architect until after implementation. Three provisional starter cards are designated in [card drafts](./DRILL_CARD_DRAFTS.md). Internal working document based on `olympia-clinic-drills.md`.

## Proposed labels

Approved focus labels are **Balance**, **Clutch / Throttle control**, **Body positioning**, and **Obstacle Crossing**. Stored values are `balance`, `clutch-throttle`, `body-position`, and `obstacles`. A drill can have multiple values. All skills selects every focus.

Durations are proposed practice blocks, including resetting between repetitions. Use the architect-approved 10-minute baseline for isolated skills. Combined techniques use the architect-approved 15-minute default. Riders can adjust their deck. These values are independent of the original class schedule.

The generation filters currently cover cones, obstacle, and incline. Exact surface and obstacle requirements belong in setup text. Obstacle means any usable obstacle, including a rock or log. Rut and sidehill drills are manually selectable in V1, with terrain requirements displayed, and excluded from automatic generation.

Proceed with the designated provisional starter library for implementation. “Clarify” identifies a specific source gap for later content review and expansion.

## Proposed metadata

| ID | Minutes | Focus | Required setup proposal | Review |
| --- | --- | --- | --- | --- |
| static-balance | 10 | balance | No listed equipment | Draft instructions |
| incline-clutch-control | 10 | clutch-throttle | Incline | Draft instructions |
| rear-brake-clutch-handoff | 10 | clutch-throttle | Incline, including a small incline | Setup confirmed. Draft instructions |
| front-stuff-balance | 10 | balance, clutch-throttle | Sizable obstacle such as a rock or log, roughly over 1 foot tall | Setup confirmed by architect. Draft instructions |
| outside-peg-mount | 10 | balance, body-position | No listed equipment. Uphill variant optional | Draft instructions |
| moving-outside-peg | 10 | balance, body-position | Open riding area | Draft instructions |
| on-command-balance | 10 | balance, clutch-throttle | Open riding area | Draft instructions |
| cone-weave | 10 | balance, clutch-throttle | Baseline 9–10 cones. Count and spacing flexible. Start widely spaced and progressively tighten | Layout approach approved. Draft instructions |
| full-lock-rectangle | 10 | balance, clutch-throttle | Adjustable cone rectangle. Count and spacing flexible | Draft instructions with adjustable dimensions |
| ready-accel-decel | 10 | body-position | Open riding area | Draft instructions |
| obstacle-approach | 10 | body-position, obstacles | Usable obstacle. Exact size/shape to confirm | Clarify obstacle and movement |
| incline-clutch-up | 15 | clutch-throttle, body-position, obstacles | Incline | Draft instructions |
| collection | 10 | clutch-throttle | Flat ground. Incline optional. Practice in motion and stationary with feet on the ground where possible | Sequence and suspension progression confirmed by architect. One card for both source entries |
| trials-gates | 15 | balance, clutch-throttle | Marked line/gates. Confirm cones and terrain | Clarify layout |
| loading-the-flywheel | 10 | clutch-throttle | Small incline | Draft instructions |
| clutch-up-engine-off | 10 | body-position, clutch-throttle | Engine off. Confirm starting setup | Clarify rehearsal sequence |
| clutch-up-engine-running | 15 | clutch-throttle, body-position | Confirm starting setup | Clarify rear-brake timing and sequence |
| rolling-suspension | 10 | body-position | Open riding area | Draft instructions |
| rolling-clutch-only-lift | 15 | clutch-throttle, body-position, obstacles | Open riding area | Draft instructions |
| full-clutch-up | 15 | clutch-throttle, body-position, obstacles | Confirm surface and starting setup | Clarify complete sequence |
| front-tire-placement | 15 | obstacles, clutch-throttle, body-position | Usable obstacle. Exact size/shape to confirm | Clarify variants and obstacle |
| unstuck | 15 | obstacles, clutch-throttle, body-position | Front tire on obstacle | Clarify obstacle and sequence |
| double-blip-demo | 15 | obstacles, clutch-throttle, body-position | Any usable obstacle. Flat ground preferred | Deferred by architect. Revisit sequence later |
| double-blip-incline | 15 | obstacles, clutch-throttle, body-position | Dirt incline | Deferred with double-blip content. Revisit sequence later |
| rut-control | 15 | balance, body-position, clutch-throttle | Rut. Confirm surface and slope | Manual selection only. Draft setup |
| sidehill-control | 15 | balance, body-position, clutch-throttle | Sidehill | Manual selection only. Clarify standalone card and setup |

## Layout decisions

The architect confirmed that cone counts and distances are flexible. For the weave, use 9–10 cones as a baseline, start widely spaced, and progressively reduce spacing. Specify no fixed minimum spacing. The rectangle also uses adjustable dimensions. Exact recalled measurements are optional reference details.

Earlier public research did not verify Larsen-specific measurements. The card setup above follows the architect's guidance.

## Collection card draft

- **Title:** Power Delivery / Clutch Control — On / Off / Out / In
- **Duration:** 10 minutes
- **Focus:** Clutch / Throttle control
- **Cue:** Throttle on, throttle off, clutch out, clutch in. Keep the two actions separate.
- **Instructions:** Start with the clutch fully pulled in. Apply throttle, then close it. Only after the throttle is closed, release the clutch, then pull it fully back in. Repeat the sequence, preserving the separation between throttle input and clutch release.
- **Practice variants:** Practice while riding in motion and while stationary with feet on the ground where possible.
- **Progression:** Combine the sequence with suspension compression to practice lifting the front wheel. Compression timing and the complete lift sequence need clarification before expanding this progression into instructions.
- **Setup:** Flat ground is suitable. An incline is optional.

The architect clarified that On / Off refers to throttle and Out / In refers to clutch. This sequence replaces the earlier RPM-only summary for card drafting.

## Next review decisions

Tracked follow-up: engineering task 13 resumes full card review and polish after V1 implementation, including the three provisional starter cards and remaining drafts.

Double-blip content is deferred. Retain the architect's [video reference starting at 11:00](https://www.youtube.com/watch?v=qhC5VH2_5QE&t=660s) for later review.

Review the 24 cards in [three batches](./DRILL_CARD_DRAFTS.md). Correct or approve each batch together. Internal review notes identify details still needed before publication.
