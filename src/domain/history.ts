import { deckSchema } from './schemas';
import type { Deck, DrillResult, DrillRevision, Session } from './schemas';

const feelLabels: Record<string, string> = {
  finding: 'Still finding it', consistent: 'Getting consistent', repeatable: 'Repeatable today',
};

/** Interpret answers against the questionnaire recorded with the result. */
export function describeRating(version: string, answers: Readonly<Record<string, unknown>>): string {
  if (version !== 'v1') return `Rating from questionnaire ${version}`;
  if (answers.feel === undefined) return 'Not rated';
  return typeof answers.feel === 'string' && feelLabels[answers.feel]
    ? feelLabels[answers.feel] : 'Unrecognized rating';
}

export interface HistoryAttempt {
  sessionId: string;
  entryId: string;
  drill: DrillRevision;
  result: DrillResult;
  ratingLabel: string;
}
export interface DrillHistory {
  drill: DrillRevision;
  completedCount: number;
  attempts: HistoryAttempt[];
}
export interface SessionHistory {
  session: Session;
  completedCount: number;
  skippedCount: number;
  unattemptedCount: number;
  entries: { entry: Deck['entries'][number]; result?: DrillResult; ratingLabel?: string }[];
}
export interface HistorySummary { sessions: SessionHistory[]; drills: DrillHistory[] }

/** Only recorded snapshots/results are used; current library edits cannot rewrite history. */
export function summarizeHistory(sessions: Session[], results: DrillResult[]): HistorySummary {
  const sorted = [...sessions].sort((a, b) => b.startedAt.localeCompare(a.startedAt) || a.id.localeCompare(b.id));
  const grouped = new Map<string, DrillHistory>();
  const history = sorted.map(session => {
    const entries = session.deckSnapshot.entries.map(entry => {
      const result = results.find(r => r.sessionId === session.id && r.entryId === entry.id);
      if (!result) return { entry };
      const ratingLabel = describeRating(result.questionnaireVersion, result.answers);
      let drill = grouped.get(entry.drill.id);
      if (!drill) {
        drill = { drill: structuredClone(entry.drill), completedCount: 0, attempts: [] };
        grouped.set(entry.drill.id, drill);
      }
      if (result.status === 'done') drill.completedCount++;
      drill.attempts.push({ sessionId: session.id, entryId: entry.id, drill: structuredClone(entry.drill), result: structuredClone(result), ratingLabel });
      return { entry, result, ratingLabel };
    });
    const completedCount = entries.filter(e => e.result?.status === 'done').length;
    const skippedCount = entries.filter(e => e.result?.status === 'skipped').length;
    return { session, completedCount, skippedCount, unattemptedCount: entries.length - completedCount - skippedCount, entries };
  });
  for (const drill of grouped.values()) {
    drill.attempts.sort((a, b) => b.result.completedAt.localeCompare(a.result.completedAt) || a.result.id.localeCompare(b.result.id));
    drill.drill = structuredClone(drill.attempts[0].drill);
  }
  return { sessions: history, drills: [...grouped.values()].sort((a, b) => a.drill.title.localeCompare(b.drill.title)) };
}

/** Repetition is always a new editable deck; embedded revisions remain unchanged. */
export function repeatDeck(snapshot: Deck, now = new Date().toISOString()): Deck {
  return deckSchema.parse({ ...structuredClone(snapshot), id: crypto.randomUUID(),
    title: `Repeat: ${snapshot.title}`.slice(0, 10000), createdAt: now, updatedAt: now,
    entries: snapshot.entries.map(entry => ({ ...structuredClone(entry), id: crypto.randomUUID() })) });
}

/** Selected drills are explicit rider choices, without history-based recommendations. */
export function deckFromHistory(drills: DrillRevision[], now = new Date().toISOString()): Deck {
  const unique = [...new Map(drills.map(drill => [drill.id, drill])).values()];
  return deckSchema.parse({ schemaVersion: 1, id: crypto.randomUUID(), title: 'Next ride',
    createdAt: now, updatedAt: now,
    generationInputs: { timeBudgetMinutes: unique.reduce((sum, d) => sum + d.suggestedDurationMinutes, 0),
      focuses: [], equipment: { cones: 'unspecified', obstacle: 'unspecified', incline: 'unspecified' } },
    entries: unique.map(drill => ({ id: crypto.randomUUID(), drill: structuredClone(drill), plannedDurationMinutes: drill.suggestedDurationMinutes })) });
}
