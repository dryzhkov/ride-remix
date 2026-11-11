import type { PracticeRepository, ImportReport } from '../../domain/repository';
import { archiveSchema } from '../../domain/schemas';

export async function exportBackup(repository: PracticeRepository): Promise<string> {
  // Validate again at the artifact boundary: secrets or unsupported fields must not leave the device.
  return JSON.stringify(archiveSchema.parse(await repository.exportArchive()), null, 2);
}
export async function restoreBackup(repository: PracticeRepository, text: string): Promise<ImportReport> {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new Error('This file is not valid JSON. Choose a Ride Remix backup.'); }
  const result = archiveSchema.safeParse(parsed);
  if (!result.success) throw new Error('This backup is invalid or uses an unsupported version. Nothing was imported.');
  return repository.importArchive(result.data);
}
