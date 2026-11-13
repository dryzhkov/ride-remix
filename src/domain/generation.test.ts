import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getStarterLibrary } from '../content/starter-library';
import { eligibleDrills, filterDrills, generateDrills } from './generation';
import type { GenerationInputs } from './generation';
import type { DrillRevision } from './schemas';
const inputs: GenerationInputs = { focuses: [], equipment: { cones: 'unspecified', obstacle: 'unspecified', incline: 'unspecified' } };
const library = () => getStarterLibrary().drills.slice(0, 3);

test('generation includes all matching drills in randomized order', () => {
  const first = generateDrills(library(), inputs, () => 0);
  const second = generateDrills(library(), inputs, () => .999);
  assert.equal(first.drills.length, 3);
  assert.equal(new Set(first.drills.map(d => d.id)).size, 3);
  assert.equal(first.drills.reduce((n,d) => n + d.suggestedDurationMinutes, 0), 30);
  assert.notDeepEqual(first.drills.map(d => d.id), second.drills.map(d => d.id));
});

test('equipment excludes only explicit unavailability; optional incline remains eligible', () => {
  assert.equal(eligibleDrills(library(), inputs).length, 3);
  const filtered = eligibleDrills(library(), { ...inputs, equipment: { cones: 'unavailable', obstacle: 'unavailable', incline: 'unavailable' } });
  assert.deepEqual(filtered.map(d => d.title), ['Moving Outside-Peg Weight', 'On / Off / Out / In Drill']);
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

test('duplicate logical revisions cannot repeat', () => {
  const drills = library();
  const generated = generateDrills([...drills, { ...drills[0], revisionId: crypto.randomUUID() }], { ...inputs, timeBudgetMinutes: 35 });
  assert.equal(generated.drills.length, 3);
  assert.equal(generated.drills.reduce((n,d) => n + d.suggestedDurationMinutes, 0), 30);
});

test('empty feedback distinguishes unsupported focus and blocked equipment', () => {
  assert.match(generateDrills(library(), { ...inputs, focuses: ['obstacle-crossing'] }).emptyReason!, /Obstacle Crossing/);
  assert.match(generateDrills([library()[0]], { ...inputs, equipment: { ...inputs.equipment, cones: 'unavailable' } }).emptyReason!, /unavailable equipment: cones/);
});

test('custom revisions use their declared durations and generation leaves inputs untouched', () => {
  const custom: DrillRevision = { ...library()[0], id: crypto.randomUUID(), revisionId: crypto.randomUUID(), origin: 'custom', suggestedDurationMinutes: 7 };
  const before = structuredClone(custom);
  const generated = generateDrills([custom], { ...inputs, timeBudgetMinutes: 7 });
  assert.deepEqual(generated.drills, [before]);
  assert.deepEqual(custom, before);
});

test('legacy budgets do not limit generation and new decks need no budget', () => {
  const expected = generateDrills(library(), inputs, () => .5);
  assert.equal(expected.drills.length, 3);
  for (const timeBudgetMinutes of [1, 9, 20, 60]) {
    assert.deepEqual(generateDrills(library(), { ...inputs, timeBudgetMinutes }, () => .5), expected);
  }
});

test('manual library filters include terrain drills while automatic generation excludes them', () => {
  const drills = getStarterLibrary().drills;
  const filtered = filterDrills(drills, inputs);
  assert.ok(filtered.some(d => d.title === 'Rut Control'));
  assert.ok(filtered.some(d => d.title === 'Sidehill Control'));
  assert.ok(!eligibleDrills(drills, inputs).some(d => !d.automaticGeneration));
  assert.ok(filterDrills(drills, { ...inputs, focuses: ['obstacle-crossing'] }).every(d => d.focusTags.includes('obstacle-crossing')));
});

test('expanded library includes every eligible drill across focus and equipment combinations', () => {
  const drills = getStarterLibrary().drills;
  const focuses: GenerationInputs['focuses'][] = [[], ['balance'], ['clutch-throttle'], ['body-positioning'], ['obstacle-crossing']];
  for (const focus of focuses) for (let mask = 0; mask < 8; mask++) {
    const equipment: GenerationInputs['equipment'] = { cones: mask & 1 ? 'available' : 'unavailable', obstacle: mask & 2 ? 'available' : 'unavailable', incline: mask & 4 ? 'available' : 'unavailable' };
    const result = generateDrills(drills, { focuses: focus, equipment }, () => .5);
    assert.equal(result.drills.length, eligibleDrills(drills, { ...inputs, focuses: focus, equipment }).length);
    assert.equal(new Set(result.drills.map(d => d.id)).size, result.drills.length);
    for (const drill of result.drills) {
      assert.equal(drill.automaticGeneration, true);
      assert.ok(!focus.length || focus.some(tag => drill.focusTags.includes(tag)));
      assert.ok(drill.requiredEquipment.every(item => equipment[item] !== 'unavailable'));
      assert.deepEqual(drill.terrainRequirements, []);
    }
  }
  assert.ok(generateDrills(drills, { ...inputs, focuses: ['obstacle-crossing'] }).drills.length > 0);
});
