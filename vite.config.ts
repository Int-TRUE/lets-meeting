import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { demoDatabasePlugin } from './server/api';
export default defineConfig({
  plugins: [react(), demoDatabasePlugin()],
  test: { include: ['src/**/*.test.ts', 'server/**/*.test.ts'] },
});
