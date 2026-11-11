import { createHash } from 'node:crypto';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { Plugin } from 'vite';
import { createWorkerSource } from './worker-source';

export function pwaBuild(): Plugin {
  let output = '';
  return {
    name: 'ride-remix-offline', apply: 'build',
    configResolved(config) { output = path.resolve(config.root, config.build.outDir); },
    async closeBundle() {
      const library = await readFile(new URL('../../content/starter-library.v1.json', import.meta.url));
      await writeFile(path.join(output, 'starter-library.v1.json'), library);
      async function files(directory: string): Promise<string[]> {
        const entries = await readdir(directory, { withFileTypes: true });
        return (await Promise.all(entries.map(e => e.isDirectory() ? files(path.join(directory, e.name)) : [path.join(directory, e.name)]))).flat();
      }
      const paths = (await files(output)).filter(p => !p.endsWith('/sw.js')).sort();
      const hash = createHash('sha256');
      hash.update(createWorkerSource([], '')); // Worker behavior changes also retire the old cache.
      for (const p of paths) { hash.update(path.relative(output, p)); hash.update(await readFile(p)); }
      const assets = paths.map(p => '/' + path.relative(output, p).split(path.sep).join('/'));
      await writeFile(path.join(output, 'sw.js'), createWorkerSource(assets, hash.digest('hex').slice(0, 20)));
    },
  };
}
