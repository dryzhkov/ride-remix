import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getStarterLibrary } from '../content/starter-library';
import { eligibleDrills, generateDrills } from './generation';
import type { GenerationInputs } from './generation';
import type { DrillRevision } from './schemas';
const inputs: GenerationInputs = { timeBudgetMinutes: 20, focuses: [], equipment: { cones: 'unspecified', obstacle: 'unspecified', incline: 'unspecified' } };
const library = () => getStarterLibrary().drills;

test('default budget selects distinct drills within 20 minutes with randomized variety', () => {
  const first = generateDrills(library(), inputs, () => 0);
  const second = generateDrills(library(), inputs, () => .999);
  assert.equal(first.drills.length, 2);
  assert.equal(new Set(first.drills.map(d => d.id)).size, 2);
  assert.equal(first.drills.reduce((n,d) => n + d.suggestedDurationMinutes, 0), 20);
  assert.notDeepEqual(first.drills.map(d => d.id), second.drills.map(d => d.id));
});

test('equipment excludes only explicit unavailability; optional incline remains eligible', () => {
  assert.equal(eligibleDrills(library(), inputs).length, 3);
  const filtered = eligibleDrills(library(), { ...inputs, equipment: { cones: 'unavailable', obstacle: 'unavailable', incline: 'unavailable' } });
  assert.deepEqual(filtered.map(d => d.title), ['Moving Outside-Peg Weight', 'Collection']);
  assert.equal(eligibleDrills(library(), { ...inputs, equipment: { ...inputs.equipment, cones: 'available' } }).length, 3);
});

test('multiple focuses use any-match and All skills removes focus filtering', () => {
  const selected = eligibleDrills(library(), { ...inputs, focuses: ['body-positioning', 'obstacle-crossing'] });
  assert.deepEqual(selected.map(d => d.title), ['Moving Outside-Peg Weight']);
  assert.equal(eligibleDrills(library(), { ...inputs, focuses: ['body-positioning', 'clutch-throttle'] }).length, 3);
  assert.equal(eligibleDrills(library(), inputs).length, 3);
});

test('manual terrain drills never enter generation even with matching equipment and focus', () => {
  const manual: DrillRevision = { ...library()[0], automaticGeneration: false, terrainRequirements: ['Rut'] };
  assert.equal(generateDrills([manual], inputs).drills.length, 0);
  assert.match(generateDrills([manual], inputs).emptyReason!, /manually/);
});

test('unused budget is acceptable and duplicate logical revisions cannot repeat', () => {
  const drills = library();
  const generated = generateDrills([...drills, { ...drills[0], revisionId: crypto.randomUUID() }], { ...inputs, timeBudgetMinutes: 35 });
  assert.equal(generated.drills.length, 3);
  assert.equal(generated.drills.reduce((n,d) => n + d.suggestedDurationMinutes, 0), 30);
});

test('empty feedback distinguishes unsupported focus, blocked equipment, and short time', () => {
  assert.match(generateDrills(library(), { ...inputs, focuses: ['obstacle-crossing'] }).emptyReason!, /Obstacle Crossing/);
  assert.match(generateDrills([library()[0]], { ...inputs, equipment: { ...inputs.equipment, cones: 'unavailable' } }).emptyReason!, /unavailable equipment: cones/);
  assert.match(generateDrills(library(), { ...inputs, timeBudgetMinutes: 9 }).emptyReason!, /at least 10 minutes/);
  assert.deepEqual(generateDrills(library(), { ...inputs, timeBudgetMinutes: 9 }).drills, []);
});

test('custom revisions use their declared durations and generation leaves inputs untouched', () => {
  const custom: DrillRevision = { ...library()[0], id: crypto.randomUUID(), revisionId: crypto.randomUUID(), origin: 'custom', suggestedDurationMinutes: 7 };
  const before = structuredClone(custom);
  const generated = generateDrills([custom], { ...inputs, timeBudgetMinutes: 7 });
  assert.deepEqual(generated.drills, [before]);
  assert.deepEqual(custom, before);
});

test('invalid time budgets are rejected rather than silently ignored', () => {
  for (const timeBudgetMinutes of [0, -1, 1.5, NaN]) assert.throws(() => generateDrills(library(), { ...inputs, timeBudgetMinutes }));
});
