# Drill card drafts

Status: full review deferred by architect until after implementation. Metadata follows [content review](./DRILL_CONTENT_REVIEW.md). Drafts use the source notes and architect clarifications.

## Provisional implementation library

Use the following three cards to implement the core flow. All use 10-minute blocks. Together they provide a 20-minute default deck with alternatives for swapping and an equipment-specific drill.

| Card ID | Focus | Required quick-filter setup | Implementation content |
| --- | --- | --- | --- |
| `cone-weave` | Balance, Clutch / Throttle control | Cones | Use the draft cue, setup, and practice text below. |
| `moving-outside-peg` | Balance, Body positioning | None | Use the draft cue, setup, and practice text below. Practice turns in both directions. |
| `collection` | Clutch / Throttle control | None. Incline optional | Use the confirmed base sequence and practice variants below. Omit the suspension/lift progression from the starter card. |

All require an appropriate riding area as described in their setup text. Other cards remain drafts for later expansion. Review notes are internal and excluded from rider-facing content. This small library does not yet cover Obstacle Crossing or every equipment filter. Empty filter results use the designed empty state.

Review each batch with corrections by drill ID. Approve wording, setup, labels, and durations together. Double-blip cards are deferred.

## Batch 1 · Balance and control

### Static Balance · `static-balance`

10 min · Balance

**Cue:** Head over foot. Steer toward the fall.

**Setup:** Space to balance in place.

**Practice:** Work on balance in both steering directions. Weight the outside peg and align your head over that foot. Steer toward the direction of the fall to correct your balance. Focus on front-brake control.

**Review:** Engine state, starting position, and how the front brake is held are unspecified.

### Incline Clutch Control · `incline-clutch-control`

10 min · Clutch / Throttle control

**Cue:** Steady engine note. Control movement with the friction zone.

**Setup:** Incline.

**Practice:** Use the clutch friction zone to control rolling up and down the incline. Keep the engine note steady as you adjust clutch engagement.

**Review:** Confirm starting position and braking inputs for the downhill movement.

### Rear Brake–Clutch Handoff · `rear-brake-clutch-handoff`

10 min · Clutch / Throttle control

**Cue:** Transfer the hold without moving.

**Setup:** Incline. A small incline works.

**Practice:** At low RPM, practice transferring between holding the bike with the rear brake and holding it through the clutch friction zone. Keep the motorcycle stationary during each handoff.

**Review:** Confirm rider position and the overlap between brake release and clutch engagement.

### Front Stuff Balance · `front-stuff-balance`

10 min · Balance, Clutch / Throttle control

**Cue:** Balance and clutch control at steady RPM.

**Setup:** Sizable obstacle such as a rock or log, roughly over 1 ft tall.

**Practice:** Combine balance and clutch control at the obstacle while maintaining steady RPM. Practice seated, then standing, then progress to rolling in.

**Review:** Specify the front tire's contact position and whether the objective is to hold it against or on the obstacle.

### Outside-Peg Mount and Dismount · `outside-peg-mount`

10 min · Balance, Body positioning

**Cue:** Find balance before swinging your leg.

**Setup:** Space beside the bike. Uphill variant optional.

**Practice:** Find balance on the outside peg before swinging a leg over the motorcycle. Practice mounting and dismounting with attention to front-brake control and full steering lock.

**Review:** Define outside peg relative to steering direction and confirm the brake/steering setup for each side.

### Moving Outside-Peg Weight · `moving-outside-peg`

10 min · Balance, Body positioning

**Cue:** Head over foot. Weight the outside peg.

**Setup:** Open riding area.

**Practice:** While moving, align your head over the outside foot and weight that peg. Progress toward full steering lock while maintaining the alignment.

**Review:** Confirm whether both turn directions should be explicitly prescribed.

### On-Command Balance · `on-command-balance`

10 min · Balance, Clutch / Throttle control

**Cue:** Carry moving balance into a complete stop.

**Setup:** Open riding area.

**Practice:** Begin with moving outside-peg balance. Come to a complete stop while preserving head-over-foot alignment and outside-peg weighting.

**Review:** Confirm stopping controls and whether to hold the stop before restarting.

### Cone Weave · `cone-weave`

10 min · Balance, Clutch / Throttle control

**Cue:** Head over foot. Outside peg. Steady RPM.

**Setup:** Start with 9–10 cones in a line. Count and spacing are flexible. Begin with wide gaps and progressively bring the cones closer together.

**Practice:** Weave through the cones, combining head-over-foot alignment, outside-peg weighting, and clutch control at steady RPM. Adjust spacing as you practice.

### Full-Lock Rectangle · `full-lock-rectangle`

10 min · Balance, Clutch / Throttle control

**Cue:** Outside peg and steady clutch control at full lock.

**Setup:** Cone rectangle with adjustable dimensions and spacing.

**Practice:** Practice full-lock turns in the rectangle, coordinating outside-peg weight, body position, and steady clutch control.

**Review:** Confirm the riding path through the rectangle and whether the turns should alternate or follow its perimeter.

## Batch 2 · Body position and power coordination

### Ready, Acceleration, and Deceleration Positions · `ready-accel-decel`

10 min · Body positioning

**Cue:** Move between the three positions.

**Setup:** Open riding area.

**Practice:** Rehearse the ready, acceleration, and deceleration positions and the transitions between them.

**Review:** Source names the positions but does not describe them. Add their body-position cues before publication.

### Power Delivery / Clutch Control — On / Off / Out / In · `collection`

10 min · Clutch / Throttle control

**Cue:** Throttle on, throttle off, clutch out, clutch in. Keep the two actions separate.

**Setup:** Flat ground. Incline optional. Practice in motion and stationary with feet on the ground where possible.

**Practice:** Start with the clutch fully pulled in. Apply throttle, then close it. Only after the throttle is closed, release the clutch, then pull it fully back in. Repeat, preserving the separation between throttle input and clutch release.

**Progression:** Combine with suspension compression to practice lifting the front wheel.

**Review:** Base sequence and variants confirmed by architect. Compression timing needs clarification before expanding the progression.

### Loading the Flywheel · `loading-the-flywheel`

10 min · Clutch / Throttle control

**Cue:** Close the throttle before the incline transition.

**Setup:** Small incline.

**Practice:** Practice timing the falling engine RPM as you approach the incline transition. Close the throttle before the transition.

**Review:** Specify the approach and clutch sequence, and define the transition point.

### Engine-Off Clutch-Up Rehearsal · `clutch-up-engine-off`

10 min · Body positioning, Clutch / Throttle control

**Cue:** Rehearse the coordination with the engine off.

**Setup:** Engine off.

**Practice:** Rehearse coordinating hip movement, suspension rebound, throttle, front brake, and clutch.

**Review:** Starting position, support for the bike, and input order are unspecified. Complete these before publishing step-by-step instructions.

### Engine-Running Clutch-Up Rehearsal · `clutch-up-engine-running`

15 min · Clutch / Throttle control, Body positioning

**Cue:** Coordinate the movement with falling RPM.

**Setup:** Engine running, one foot down.

**Practice:** Use the one-foot-down progression to rehearse clutch-up coordination, paying attention to falling RPM.

**Review:** Confirm the starting setup, complete input sequence, and rear-brake timing.

### Rolling Suspension Compression and Rebound · `rolling-suspension`

10 min · Body positioning

**Cue:** Coordinate with the rebound. Avoid pulling on the bars.

**Setup:** Open riding area.

**Practice:** While rolling, practice suspension compression and the body-position transition as the suspension rebounds.

**Review:** Specify body movement and timing through compression and rebound.

### Rolling Clutch-Only Lift · `rolling-clutch-only-lift`

15 min · Clutch / Throttle control, Body positioning, Obstacle Crossing

**Cue:** Steady throttle. Coordinate suspension and clutch.

**Setup:** Open riding area. Builds on Incline Clutch-Up.

**Practice:** While rolling, maintain steady throttle and coordinate suspension movement with clutch timing to practice lifting the front wheel.

**Review:** Add exact clutch timing and return control. Review the related Incline Clutch-Up card together.

## Batch 3 · Obstacles, lines, and terrain

### Obstacle Approach Body Position · `obstacle-approach`

10 min · Body positioning, Obstacle Crossing

**Cue:** Coordinate your position with front-tire contact.

**Setup:** Usable obstacle.

**Practice:** Practice the body-position change as the front tire transitions onto the obstacle.

**Review:** Define the position change and suitable obstacle size/shape.

### Incline Clutch-Up · `incline-clutch-up`

15 min · Clutch / Throttle control, Body positioning, Obstacle Crossing

**Cue:** Weight shift, rebound, clutch timing, controlled return.

**Setup:** Incline.

**Practice:** Coordinate weight shift, suspension rebound, and clutch timing to practice lifting the front wheel. Include control of the front wheel's return.

**Review:** Specify the starting position and input order, including return controls.

### Trials Lines and Gates · `trials-gates`

15 min · Balance, Clutch / Throttle control

**Cue:** Connect balance and control along a marked line.

**Setup:** Marked line with gates.

**Practice:** Follow the marked line, combining balance, body position, and clutch/throttle control through the gates.

**Review:** Confirm marker requirements and a flexible baseline layout.

### Full Clutch-Up · `full-clutch-up`

15 min · Clutch / Throttle control, Body positioning, Obstacle Crossing

**Cue:** Combine the clutch-up components.

**Setup:** Pending review.

**Practice:** Combine the earlier clutch-up rehearsals into the complete movement.

**Review:** Source provides only this summary. Supply the complete sequence and setup before publication.

### Front-Tire Placement · `front-tire-placement`

15 min · Obstacle Crossing, Clutch / Throttle control, Body positioning

**Cue:** Place the front tire on the obstacle.

**Setup:** Usable obstacle, one-foot-down progression.

**Practice:** Use the one-foot-down progression to practice placing the front tire on the obstacle.

**Review:** Define obstacle size, input sequence, and direct/indirect power variants.

### Unstuck Technique · `unstuck`

15 min · Obstacle Crossing, Clutch / Throttle control, Body positioning

**Cue:** Pay attention to clutch-release timing.

**Setup:** Start with the front tire on an obstacle.

**Practice:** Rehearse the unstuck movement from this starting position. Watch for early clutch release.

**Review:** Movement and correct release timing are missing from the source. Complete the sequence before publication.

### Rut Control · `rut-control`

15 min · Balance, Body positioning, Clutch / Throttle control

**Cue:** Downhill peg weight and rear-wheel traction.

**Setup:** Rut. Manually selectable.

**Practice:** Focus on downhill peg weighting and maintaining rear-wheel traction through throttle and clutch control.

**Review:** Confirm rut orientation, slope, and how downhill peg applies to the setup.

### Sidehill Control · `sidehill-control`

15 min · Balance, Body positioning, Clutch / Throttle control

**Cue:** Pending review.

**Setup:** Sidehill. Manually selectable.

**Practice:** Pending standalone instructions.

**Review:** Source links this to rut technique without a separate sequence. Confirm whether this should remain a standalone card or become a rut-control variant.
