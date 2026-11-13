import type { z } from 'zod';
import { generationInputsSchema } from './schemas';
import type { DrillRevision } from './schemas';

export type GenerationInputs = z.infer<typeof generationInputsSchema>;
export type GenerationResult = { drills: DrillRevision[]; emptyReason?: string };
export const focusLabels = {
  balance: 'Balance', 'clutch-throttle': 'Clutch / Throttle control',
  'body-positioning': 'Body positioning', 'obstacle-crossing': 'Obstacle Crossing',
} as const;
export function filterDrills(library: DrillRevision[], inputs: GenerationInputs): DrillRevision[] {
  return library.filter(d =>
    (!inputs.focuses.length || inputs.focuses.some(f => d.focusTags.includes(f))) &&
    !d.requiredEquipment.some(e => inputs.equipment[e] === 'unavailable'));
}

export function eligibleDrills(library: DrillRevision[], inputs: GenerationInputs): DrillRevision[] {
  return filterDrills(library, inputs).filter(d => d.automaticGeneration);
}

/** Shuffle all matching automatic drills, preserving one card per logical drill. */
export function generateDrills(library: DrillRevision[], rawInputs: GenerationInputs, random: () => number = Math.random): GenerationResult {
  const inputs = generationInputsSchema.parse(rawInputs);
  const eligible = eligibleDrills(library, inputs);
  if (!eligible.length) {
    const automatic = library.filter(d => d.automaticGeneration);
    const focused = automatic.filter(d => !inputs.focuses.length || inputs.focuses.some(f => d.focusTags.includes(f)));
    if (!automatic.length) return { drills: [], emptyReason: 'No drills are available for automatic generation. Select a drill manually from the library.' };
    if (!focused.length) return { drills: [], emptyReason: `No automatic drills match ${inputs.focuses.map(f => focusLabels[f]).join(' or ')}. Choose All skills or another focus.` };
    const blocked = [...new Set(focused.flatMap(d => d.requiredEquipment.filter(e => inputs.equipment[e] === 'unavailable')))];
    return { drills: [], emptyReason: `Matching drills require unavailable equipment: ${blocked.join(', ')}. Adjust your equipment choices or select a different focus.` };
  }
  const shuffled = [...eligible];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const drills: DrillRevision[] = [];
  const ids = new Set<string>();
  for (const drill of shuffled) {
    if (!ids.has(drill.id)) {
      drills.push(drill); ids.add(drill.id);
    }
  }
  return { drills };
}
