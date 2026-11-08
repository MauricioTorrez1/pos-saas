import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

import { describe, expect, it } from 'vitest';

const SOURCE_ROOT = resolve(import.meta.dirname, '..');
/** Code that runs on the screen, or is compiled into it. */
const SCREEN_FOLDERS = ['renderer', 'shared'];
/** Folders that only the main process and its preload may load: the hardware, the database, and Electron itself. */
const MAIN_PROCESS_FOLDERS = ['main', 'preload'].map((folder) => join(SOURCE_ROOT, folder) + sep);
/** Matches `from '…'`, `import '…'`, and `import('…')`, which covers every way to load a module. */
const IMPORT_SPECIFIER = /\b(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g;

function screenSourceFiles(): string[] {
  return SCREEN_FOLDERS.flatMap((folder) =>
    readdirSync(join(SOURCE_ROOT, folder), { recursive: true, encoding: 'utf8' })
      .filter((file) => /\.tsx?$/.test(file))
      .map((file) => join(SOURCE_ROOT, folder, file)),
  );
}

function importSpecifiers(file: string): string[] {
  return [...readFileSync(file, 'utf8').matchAll(IMPORT_SPECIFIER)].map((match) => match[1]!);
}

/**
 * Tells whether an import would pull main-process code into the screen.
 *
 * @param importingFile absolute path of the file that has the import
 * @param specifier what it imports
 * @returns true if it reaches Electron or a file in `src/main` or `src/preload`
 */
function reachesMainProcess(importingFile: string, specifier: string): boolean {
  if (specifier === 'electron' || specifier.startsWith('electron/')) {
    return true;
  }
  if (!specifier.startsWith('.')) {
    return false;
  }
  const target = resolve(dirname(importingFile), specifier);
  return MAIN_PROCESS_FOLDERS.some((folder) => target.startsWith(folder));
}

describe('screen boundary', () => {
  it('keeps the screen away from the hardware, the database, and Electron', () => {
    const files = screenSourceFiles();
    const violations = files.flatMap((file) =>
      importSpecifiers(file)
        .filter((specifier) => reachesMainProcess(file, specifier))
        .map((specifier) => `${relative(SOURCE_ROOT, file)} imports ${specifier}`),
    );

    // Guards against a scan that finds nothing and passes for that reason.
    expect(files.map((file) => relative(SOURCE_ROOT, file))).toContain(join('renderer', 'App.tsx'));
    expect(importSpecifiers(join(SOURCE_ROOT, 'renderer', 'App.tsx'))).toContain('../shared/pos-api');
    expect(violations).toEqual([]);
  });

  it('tells the screen-side imports it allows from the ones it refuses', () => {
    const app = join(SOURCE_ROOT, 'renderer', 'App.tsx');

    expect(reachesMainProcess(app, '../main/hardware/fakes/recording-printer')).toBe(true);
    expect(reachesMainProcess(app, '../preload/index')).toBe(true);
    expect(reachesMainProcess(app, 'electron')).toBe(true);
    expect(reachesMainProcess(app, '../shared/pos-api')).toBe(false);
    expect(reachesMainProcess(app, './App')).toBe(false);
    expect(reachesMainProcess(app, 'react')).toBe(false);
  });
});
