import { defineConfig } from 'vite';

// Production is served from https://jleape.github.io/apps/whereabouts/, so built
// asset + data URLs need the /apps/whereabouts/ prefix. Dev stays at root.
// Code reads import.meta.env.BASE_URL to build data fetch paths accordingly.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/apps/whereabouts/' : '/',
}));
