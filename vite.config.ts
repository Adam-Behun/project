import { defineConfig } from 'vite';

// Project pages live under /crosswalk/. Override with BASE_PATH for other hosts.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/crosswalk/',
  publicDir: 'public',
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022' },
});
