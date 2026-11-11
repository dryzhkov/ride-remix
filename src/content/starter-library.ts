import { z } from 'zod';
import { drillRevisionSchema } from '../domain/schemas';
import source from './starter-library.v1.json';

export const librarySchema = z.strictObject({
  schemaVersion: z.literal(1),
  libraryVersion: z.number().int().positive(),
  drills: z.array(drillRevisionSchema).min(1),
}).superRefine((library, ctx) => {
  if (library.drills.some(drill => drill.origin !== 'built-in')) {
    ctx.addIssue({ code: 'custom', message: 'Library cards must be built-in revisions' });
  }
  for (const key of ['id', 'revisionId'] as const) {
    if (new Set(library.drills.map(drill => drill[key])).size !== library.drills.length) {
      ctx.addIssue({ code: 'custom', message: `Duplicate library ${key}` });
    }
  }
});
export type DrillLibrary = z.infer<typeof librarySchema>;

const library = librarySchema.parse(source);

/** A fresh copy keeps deck edits from mutating the installed library. */
export function getStarterLibrary(): DrillLibrary {
  return structuredClone(library);
}
