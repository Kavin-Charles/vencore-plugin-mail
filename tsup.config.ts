import { defineConfig } from 'tsup';
import { defineClientBuild } from '@vencore/plugin-sdk/build';

export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    format: ['cjs'],
    external: ['@vencore/plugin-sdk', '@vencore/plugin-types', 'react', 'react-dom'],
    noExternal: [/(.*)/],
    outDir: 'dist',
    bundle: true,
    clean: true,
  },
  defineClientBuild() as any,
]);
