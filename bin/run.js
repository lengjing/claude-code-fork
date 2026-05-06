#!/usr/bin/env node
/**
 * Cross-platform shim for the free-code CLI binary.
 *
 * On Windows, `bun compile` produces `cli.exe` next to this file.
 * On macOS/Linux it produces `cli` (no extension, chmod +x).
 *
 * This wrapper resolves the correct binary name and spawns it,
 * forwarding all arguments and stdio, so `npm exec claude` / `npx claude`
 * works on every platform.
 */

import { spawnSync } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const isWindows = process.platform === 'win32';
const binaryName = isWindows ? 'cli.exe' : 'cli';
const binaryPath = join(__dirname, '..', binaryName);

const result = spawnSync(binaryPath, process.argv.slice(2), {
  stdio: 'inherit',
  windowsHide: false,
});

if (result.error) {
  // Binary not found or not executable — provide a helpful message
  process.stderr.write(
    `[free-code] Could not launch ${binaryPath}: ${result.error.message}\n` +
    `Run 'bun run build' inside packages/free-code to build the CLI first.\n`,
  );
  process.exit(1);
}

process.exit(result.status ?? 0);
