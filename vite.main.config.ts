import { defineConfig } from 'vite';
import { builtinModules } from 'node:module';

const nodeExternals = [
  ...builtinModules,
  ...builtinModules.map((moduleName) => `node:${moduleName}`),
];

export default defineConfig({
  build: {
    emptyOutDir: false,
    lib: {
      entry: 'src/main/index.ts',
      formats: ['es'],
      fileName: () => 'main.js',
    },
    outDir: '.vite/build',
    target: 'node22',
    rollupOptions: {
      external: [
        'better-sqlite3',
        'electron',
        'electron-squirrel-startup',
        'imapflow',
        ...nodeExternals,
      ],
    },
    sourcemap: false,
  },
});
