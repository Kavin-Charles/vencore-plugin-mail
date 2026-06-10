import { defineConfig } from 'tsup';
import { defineClientBuild } from '@vencore/plugin-sdk/build';

export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    format: ['cjs'],
    noExternal: [/(.*)/],
    outDir: 'dist',
    bundle: true,
    clean: true,
  },
  defineClientBuild() as any,
]);
