import { z } from 'zod';

export const idSchema = z.uuid();
const timestamp = z.iso.datetime();
const text = z.string().trim().min(1).max(10000);
export const focusSchema = z.enum(['balance', 'clutch-throttle', 'body-positioning', 'obstacle-crossing']);
export const equipmentSchema = z.enum(['cones', 'obstacle', 'incline']);
export const generationInputsSchema = z.strictObject({
  // Accepted only to preserve existing deck snapshots and backups; never used for selection.
  timeBudgetMinutes: z.number().int().positive().optional(),
  focuses: z.array(focusSchema).default([]),
  equipment: z.strictObject({
    cones: z.enum(['available', 'unavailable', 'unspecified']),
    obstacle: z.enum(['available', 'unavailable', 'unspecified']),
    incline: z.enum(['available', 'unavailable', 'unspecified']),
  }),
});
export const drillRevisionSchema = z.strictObject({
  schemaVersion: z.literal(1), id: idSchema, revisionId: idSchema,
  origin: z.enum(['built-in', 'custom']),
  derivedFrom: z.strictObject({ id: idSchema, revisionId: idSchema }).optional(),
  title: text, cue: text, instructions: z.array(text).min(1), setupDetails: z.array(text),
  focusTags: z.array(focusSchema).min(1), requiredEquipment: z.array(equipmentSchema),
  terrainRequirements: z.array(text), automaticGeneration: z.boolean(),
  suggestedDurationMinutes: z.number().int().positive(), createdAt: timestamp,
});
export const deckEntrySchema = z.strictObject({
  id: idSchema, drill: drillRevisionSchema, plannedDurationMinutes: z.number().int().positive(),
});
export const deckSchema = z.strictObject({
  schemaVersion: z.literal(1), id: idSchema, title: text,
  generationInputs: generationInputsSchema, entries: z.array(deckEntrySchema).min(1),
  createdAt: timestamp, updatedAt: timestamp,
}).superRefine((deck, ctx) => {
  for (const key of ['id', 'drill'] as const) {
    const ids = deck.entries.map(e => key === 'id' ? e.id : e.drill.id);
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', message: `Duplicate entry ${key}` });
  }
});
export const sessionSchema = z.strictObject({
  schemaVersion: z.literal(1), id: idSchema, deckId: idSchema, deckSnapshot: deckSchema,
  startedAt: timestamp, endedAt: timestamp.optional(),
  status: z.enum(['active', 'completed', 'ended-early']), currentEntry: z.number().int().nonnegative(),
}).superRefine((s, ctx) => {
  if (s.deckId !== s.deckSnapshot.id || s.currentEntry > s.deckSnapshot.entries.length ||
      (s.status === 'active' && (s.endedAt !== undefined || s.currentEntry === s.deckSnapshot.entries.length)) ||
      (s.status !== 'active' && !s.endedAt) ||
      (s.status === 'completed' && s.currentEntry !== s.deckSnapshot.entries.length)) {
    ctx.addIssue({ code: 'custom', message: 'Invalid session state' });
  }
});
export const resultSchema = z.strictObject({
  schemaVersion: z.literal(1), id: idSchema, sessionId: idSchema, entryId: idSchema,
  status: z.enum(['done', 'skipped']), completedAt: timestamp,
  questionnaireVersion: z.literal('v1'),
  answers: z.strictObject({ feel: z.enum(['finding', 'consistent', 'repeatable']).optional() }),
  setupSnapshot: z.array(text),
}).refine(r => r.status !== 'skipped' || r.answers.feel === undefined, 'Skipped drills cannot be rated');
export type DrillRevision = z.infer<typeof drillRevisionSchema>;
export type Deck = z.infer<typeof deckSchema>;
export type Session = z.infer<typeof sessionSchema>;
export type DrillResult = z.infer<typeof resultSchema>;

export const archiveSchema = z.strictObject({
  archiveVersion: z.literal(1), exportedAt: timestamp,
  revisions: z.array(drillRevisionSchema), decks: z.array(deckSchema),
  sessions: z.array(sessionSchema), results: z.array(resultSchema),
}).superRefine((a, ctx) => {
  for (const [records, key] of [[a.revisions, 'revisionId'], [a.decks, 'id'], [a.sessions, 'id'], [a.results, 'id']] as const) {
    const ids = records.map(r => key === 'revisionId' && 'revisionId' in r ? r.revisionId : r.id);
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', message: 'Duplicate archive IDs' });
  }
  if (a.sessions.filter(s => s.status === 'active').length > 1) ctx.addIssue({ code: 'custom', message: 'Multiple active sessions' });
  const pairs = new Set<string>();
  for (const r of a.results) {
    const s = a.sessions.find(s => s.id === r.sessionId);
    const entry = s?.deckSnapshot.entries.find(e => e.id === r.entryId);
    const pair = `${r.sessionId}/${r.entryId}`;
    if (!entry || pairs.has(pair) || JSON.stringify(entry.drill.setupDetails) !== JSON.stringify(r.setupSnapshot)) {
      ctx.addIssue({ code: 'custom', message: 'Invalid result reference or setup' });
    }
    pairs.add(pair);
  }
  for (const s of a.sessions) {
    const results = a.results.filter(r => r.sessionId === s.id);
    const expected = s.deckSnapshot.entries.slice(0, s.currentEntry);
    if (results.length !== expected.length || expected.some(e => !results.some(r => r.entryId === e.id))) {
      ctx.addIssue({ code: 'custom', message: 'Session position does not match results' });
    }
  }
});
export type Archive = z.infer<typeof archiveSchema>;
