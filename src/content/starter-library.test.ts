import assert from 'node:assert/strict';
import { test } from 'node:test';
import { drillRevisionSchema } from '../domain/schemas';
import { getStarterLibrary, librarySchema } from './starter-library';
import source from './starter-library.v1.json';

test('starter asset validates with all 24 approved cards and stable UUID identities', () => {
  const library = librarySchema.parse(source);
  assert.equal(library.schemaVersion, 1);
  assert.equal(library.libraryVersion, 3);
  assert.deepEqual(library.drills.slice(0, 2).map(d => [d.title, d.id, d.revisionId]), [
    ['Cone Weave', '18be1346-455b-4ad9-8a2a-2d4b04734093', '39b47a0c-29a7-441f-9bc6-05dc51422e71'],
    ['Moving Outside-Peg Weight', '1f2bc57c-3a94-4866-9f90-149c772d9e02', '19c248f2-6503-4fc5-a43a-93504c127c13'],
  ]);
  assert.equal(library.drills.length, 24);
  const renamed = library.drills[2];
  assert.equal(renamed.id, '8200e165-97cd-4d53-90c9-98a3c8e459a4');
  assert.equal(renamed.title, 'On / Off / Out / In Drill');
  assert.notEqual(renamed.revisionId, '5c42903c-6260-4592-b789-0f6d1ddf9782');
  assert.deepEqual(library.drills.filter(d => !d.automaticGeneration).map(d => d.title), ['Rut Control', 'Sidehill Control']);
  for (const drill of library.drills) {
    assert.ok(drillRevisionSchema.safeParse(drill).success);
    assert.ok([10, 15].includes(drill.suggestedDurationMinutes));
    assert.equal(drill.origin, 'built-in');

  }
});

test('focus and equipment metadata support the generation filters', () => {
  const [weave, moving, collection] = getStarterLibrary().drills;
  assert.deepEqual(weave.focusTags, ['balance', 'clutch-throttle']);
  assert.deepEqual(weave.requiredEquipment, ['cones']);
  assert.deepEqual(moving.focusTags, ['balance', 'body-positioning']);
  assert.deepEqual(moving.requiredEquipment, []);
  assert.deepEqual(collection.focusTags, ['clutch-throttle']);
  assert.deepEqual(collection.requiredEquipment, []); // Optional incline must never exclude this card.
  assert.deepEqual(collection.terrainRequirements, []);
  assert.match(collection.setupDetails.join(' '), /incline is optional/i);
});

test('rider content preserves confirmed variants and excludes unresolved progression and provenance', () => {
  const library = getStarterLibrary();
  const moving = library.drills[1];
  const collection = library.drills[2];
  assert.match(moving.instructions.join(' '), /both directions/);
  assert.match(collection.instructions.join(' '), /Only after the throttle is closed, release the clutch/);
  assert.match(collection.instructions.join(' '), /in motion and stationary with feet on the ground/);
  assert.doesNotMatch(JSON.stringify(collection), /suspension|compression|lift|front wheel/i);
  assert.doesNotMatch(JSON.stringify(library), /olympia|clinic|architect|review|draft|source|day\s*\d|\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|\d{1,2}:\d{2}\s*(?:am|pm)/i);
});

test('library rejects duplicate cards, unsupported schemas, custom origins, and internal fields', () => {
  const library = getStarterLibrary();
  assert.equal(librarySchema.safeParse({ ...library, drills: [...library.drills, library.drills[0]] }).success, false);
  assert.equal(librarySchema.safeParse({ ...library, schemaVersion: 2 }).success, false);
  assert.equal(librarySchema.safeParse({ ...library, drills: [{ ...library.drills[0], origin: 'custom' }] }).success, false);
  assert.equal(librarySchema.safeParse({ ...library, drills: [{ ...library.drills[0], sourceNotes: 'Internal' }] }).success, false);
});

test('each library read is independent from edits made by a caller', () => {
  const edited = getStarterLibrary();
  edited.drills[0].title = 'Changed';
  edited.drills[0].instructions.push('Changed');
  assert.deepEqual(getStarterLibrary(), source);
});
