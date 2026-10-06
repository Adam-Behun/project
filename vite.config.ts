import { defineConfig } from 'vite';

// Project Pages serve under /<repo>/, and the repository is `Crosswalk`. The
// deploy workflow passes BASE_PATH from the repository name; this is the local
// default, and it is case-sensitive.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/Crosswalk/',
  publicDir: 'public',
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022' },
});
