import { build } from 'esbuild';
await build({
  entryPoints: ['server/selfhost.mjs'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  packages: 'external',
  outfile: 'build/server.mjs',
});
