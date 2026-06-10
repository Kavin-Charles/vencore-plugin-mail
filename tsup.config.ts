import { defineConfig } from 'tsup';
import { defineClientBuild } from '@vencore/plugin-sdk/build';

export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    format: ['cjs'],
    outDir: 'dist',
    bundle: true,
    clean: true,
    esbuildOptions(options) {
      options.packages = 'external';
    },
  },
  defineClientBuild() as any,
]);
