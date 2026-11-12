import { defineConfig } from 'tsup';

// SQLite is a prefix-only Node builtin. Preserve node: imports in production output.
export default defineConfig({ removeNodeProtocol: false });
