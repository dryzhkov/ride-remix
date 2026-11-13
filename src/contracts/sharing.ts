import { z } from 'zod';
import { deckEntrySchema, deckSchema, drillRevisionSchema, generationInputsSchema } from '../domain/schemas';

export const sharingLimits = {
  bodyBytes: 128 * 1024, entries: 30, titleLength: 200, cueLength: 500,
  instructionCount: 30, instructionLength: 4000, setupCount: 20, setupLength: 1000,
  terrainCount: 10, durationMinutes: 1440,
} as const;
const text = (max: number) => z.string().trim().min(1).max(max);
export const sharedDrillSchema = drillRevisionSchema.extend({
  title: text(sharingLimits.titleLength), cue: text(sharingLimits.cueLength),
  instructions: z.array(text(sharingLimits.instructionLength)).min(1).max(sharingLimits.instructionCount),
  setupDetails: z.array(text(sharingLimits.setupLength)).max(sharingLimits.setupCount),
  terrainRequirements: z.array(text(sharingLimits.setupLength)).max(sharingLimits.terrainCount),
  focusTags: drillRevisionSchema.shape.focusTags.max(4), requiredEquipment: drillRevisionSchema.shape.requiredEquipment.max(3),
  suggestedDurationMinutes: z.number().int().positive().max(sharingLimits.durationMinutes),
});
export const sharedDeckSchema = deckSchema.safeExtend({
  title: text(sharingLimits.titleLength),
  generationInputs: generationInputsSchema.extend({ timeBudgetMinutes: z.number().int().positive().max(sharingLimits.durationMinutes).optional() }),
  entries: z.array(deckEntrySchema.extend({ drill: sharedDrillSchema, plannedDurationMinutes: z.number().int().positive().max(sharingLimits.durationMinutes) })).min(1).max(sharingLimits.entries),
});
export const publicIdSchema = z.string().regex(/^[A-Za-z0-9_-]{32}$/);
export const publishRequestSchema = z.strictObject({ requestId: z.uuid(), payloadVersion: z.literal(1), deck: sharedDeckSchema });
export const publicationResponseSchema = z.strictObject({ id: publicIdSchema, url: z.url(), createdAt: z.iso.datetime(), payloadVersion: z.literal(1) });
export const sharedDeckResponseSchema = publicationResponseSchema.omit({ url: true }).extend({ deck: sharedDeckSchema });
export type PublishRequest = z.infer<typeof publishRequestSchema>;
export type Publication = z.infer<typeof publicationResponseSchema>;
export type SharedDeck = z.infer<typeof sharedDeckResponseSchema>;
export const sharingFixtures = {
  publication: { id: 'a'.repeat(32), url: `https://ride.example.com/s/${'a'.repeat(32)}`, createdAt: '2026-11-10T00:00:00.000Z', payloadVersion: 1 },
} as const;
