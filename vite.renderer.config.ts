import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    emptyOutDir: true,
    outDir: '../../.vite/renderer/main_window',
    sourcemap: false,
  },
  plugins: [react()],
  root: 'src/renderer',
});
