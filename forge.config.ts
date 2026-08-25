import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const productionRuntimePackages = new Set<string>();
const collectRuntimePackage = (packageName: string): void => {
  if (productionRuntimePackages.has(packageName)) return;
  const manifestPath = path.resolve('node_modules', packageName, 'package.json');
  if (!existsSync(manifestPath)) {
    throw new Error(`Missing packaged runtime dependency: ${packageName}`);
  }
  productionRuntimePackages.add(packageName);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    dependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
  };
  for (const dependency of Object.keys({
    ...manifest.dependencies,
    ...manifest.optionalDependencies,
  })) {
    collectRuntimePackage(dependency);
  }
};

collectRuntimePackage('imapflow');
collectRuntimePackage('electron-squirrel-startup');
collectRuntimePackage('update-electron-app');

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    executableName: 'Sift',
    prune: false,
    // The Vite plugin otherwise keeps only `.vite`. The database adapter is
    // intentionally externalized so Electron can load its native N-API binary.
    ignore: (file) => {
      if (!file) return false;

      if (file === '/package.json' || file === '/node_modules') return false;
      if (file === '/.vite' || file.startsWith('/.vite/')) return false;

      const sqliteRoot = '/node_modules/better-sqlite3';
      if (file === sqliteRoot) return false;

      const sqliteRuntimeFiles = [
        `${sqliteRoot}/package.json`,
        `${sqliteRoot}/LICENSE`,
        `${sqliteRoot}/prebuilds`,
        `${sqliteRoot}/prebuilds/win32-x64.node`,
      ];

      if (sqliteRuntimeFiles.includes(file)) return false;
      if (
        file === `${sqliteRoot}/lib` ||
        file.startsWith(`${sqliteRoot}/lib/`)
      ) {
        return false;
      }

      for (const packageName of productionRuntimePackages) {
        if (packageName.startsWith('@')) {
          const scope = packageName.split('/')[0];
          if (file === `/node_modules/${scope}`) return false;
        }
      }

      for (const packageName of productionRuntimePackages) {
        const packageRoot = `/node_modules/${packageName}`;
        if (file === packageRoot || file === `${packageRoot}/package.json`) {
          return false;
        }
        if (!file.startsWith(`${packageRoot}/`)) continue;

        const relative = file.slice(packageRoot.length + 1);
        if (
          /(?:^|\/)(?:tests?|docs?|examples?|benchmarks?|coverage)(?:\/|$)/i.test(
            relative,
          ) ||
          /\.(?:map|md|ts)$/i.test(relative)
        ) {
          return true;
        }
        return false;
      }

      return true;
    },
  },
  // better-sqlite3 13 ships N-API prebuilds. Rebuilding it would unnecessarily
  // require a local C++ toolchain and would replace the portable signed binary.
  rebuildConfig: {
    ignoreModules: ['better-sqlite3'],
  },
  makers: [
    new MakerSquirrel({
      name: 'sift',
      setupExe: 'Sift-Setup.exe',
      noMsi: true,
    }),
  ],
  plugins: [
    new AutoUnpackNativesPlugin({}),
    new VitePlugin({
      build: [
        {
          entry: 'src/main/index.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'src/preload/preload.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.ts',
        },
      ],
    }),
  ],
};

export default config;
