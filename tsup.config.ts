import { defineConfig } from 'tsup';

export default defineConfig({
  entry: [
    'bin/cli.ts',
    'packages/**/index.ts'
  ],
  outDir: 'dist',
  dts: true,
  splitting: false,
  format: ['esm', 'cjs'],
  target: 'esnext',
  sourcemap: true,
  clean: true,
  skipNodeModulesBundle: true,
  treeshake: true,
  onSuccess: 'mkdir -p dist/packages/mcp dist/bin && cp packages/mcp/instructions.md dist/packages/mcp/instructions.md && cp packages/mcp/instructions.md dist/bin/instructions.md'
});
