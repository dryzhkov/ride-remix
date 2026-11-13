import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getStarterLibrary } from '../content/starter-library';
import { deckFromHistory, describeRating, repeatDeck, summarizeHistory } from './history';
import type { DrillResult, Session } from './schemas';

const firstTime = '2026-11-01T10:00:00.000Z';
const laterTime = '2026-11-02T10:00:00.000Z';
function session(time = firstTime): Session {
  const deck = deckFromHistory(getStarterLibrary().drills, time);
  return { schemaVersion: 1, id: crypto.randomUUID(), deckId: deck.id, deckSnapshot: deck, startedAt: time, status: 'active', currentEntry: 0 };
}
function result(s: Session, index: number, status: DrillResult['status'], rated = true): DrillResult {
  return { schemaVersion: 1, id: crypto.randomUUID(), sessionId: s.id, entryId: s.deckSnapshot.entries[index].id,
    status, completedAt: s.startedAt, questionnaireVersion: 'v1', answers: rated && status === 'done' ? { feel: 'consistent' } : {},
    setupSnapshot: structuredClone(s.deckSnapshot.entries[index].drill.setupDetails) };
}

test('counts done results across revisions, excluding skips and unattempted entries', () => {
  const older = session(); const newer = session(laterTime);
  const oldDrill = older.deckSnapshot.entries[0].drill;
  const newDrill = newer.deckSnapshot.entries[0].drill;
  newDrill.title = 'Updated title'; newDrill.revisionId = crypto.randomUUID(); newDrill.setupDetails = ['Different setup'];
  older.status = 'ended-early'; older.currentEntry = 2; older.endedAt = firstTime;
  newer.currentEntry = 1;
  const olderDone = result(older, 0, 'done'); const skip = result(older, 1, 'skipped');
  const newerDone = result(newer, 0, 'done', false);
  const summary = summarizeHistory([older, newer], [olderDone, skip, newerDone]);
  assert.equal(summary.sessions[0].session.id, newer.id);
  assert.equal(summary.sessions[1].completedCount, 1); assert.equal(summary.sessions[1].skippedCount, 1);
  assert.equal(summary.sessions[1].unattemptedCount, older.deckSnapshot.entries.length - 2);
  const drill = summary.drills.find(d => d.drill.id === oldDrill.id)!;
  assert.equal(drill.completedCount, 2); assert.equal(drill.drill.title, 'Updated title');
  assert.deepEqual(drill.attempts.map(a => a.ratingLabel), ['Not rated', 'Getting consistent']);
  assert.deepEqual(drill.attempts[1].result.setupSnapshot, oldDrill.setupDetails);
  assert.equal(summary.drills.find(d => d.drill.id === older.deckSnapshot.entries[1].drill.id)?.completedCount, 0);
  assert.equal(summary.drills.some(d => d.drill.id === older.deckSnapshot.entries[2].drill.id), false);
});

test('rating labels use recorded questionnaire version, retaining unknown versions', () => {
  assert.equal(describeRating('v1', { feel: 'finding' }), 'Still finding it');
  assert.equal(describeRating('v1', { feel: 'repeatable' }), 'Repeatable today');
  assert.equal(describeRating('v1', {}), 'Not rated');
  assert.equal(describeRating('v2', { feel: 'repeatable' }), 'Rating from questionnaire v2');
  assert.equal(describeRating('v1', { feel: 'new-code' }), 'Unrecognized rating');
});

test('repeat deck renews deck and entry IDs while preserving immutable content and order', () => {
  const original = session().deckSnapshot; const snapshot = structuredClone(original);
  const repeated = repeatDeck(original, laterTime);
  assert.notEqual(repeated.id, original.id);
  assert.equal(repeated.createdAt, laterTime);
  assert.deepEqual(repeated.entries.map(e => e.drill), original.entries.map(e => e.drill));
  assert.ok(repeated.entries.every((e, i) => e.id !== original.entries[i].id));
  repeated.entries[0].drill.title = 'Local edit';
  assert.deepEqual(original, snapshot);
});

test('explicit next deck selection deduplicates logical drills and keeps selected revisions', () => {
  const drills = getStarterLibrary().drills; const original = structuredClone(drills);
  const deck = deckFromHistory([drills[1], drills[0], drills[1]], laterTime);
  assert.deepEqual(deck.entries.map(e => e.drill.id), [drills[1].id, drills[0].id]);
  assert.equal(deck.generationInputs.timeBudgetMinutes, drills[1].suggestedDurationMinutes + drills[0].suggestedDurationMinutes);
  assert.deepEqual(deck.generationInputs.equipment, { cones: 'unspecified', obstacle: 'unspecified', incline: 'unspecified' });
  assert.deepEqual(drills, original);
  assert.throws(() => deckFromHistory([]));
});

