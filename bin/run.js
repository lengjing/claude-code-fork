#!/usr/bin/env node
/**
 * Cross-platform launcher for @claude-code-fork/claude-code.
 *
 * Resolves the platform-specific binary from the optional dependency package
 * (@claude-code-fork/cli-{platform}-{arch}), then spawns it with all
 * arguments forwarded, so `npx claude` / `npm exec claude` works everywhere.
 */

import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { createRequire } from 'module';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const isWindows = process.platform === 'win32';
const binaryName = isWindows ? 'claude-code-fork.exe' : 'claude-code-fork';

/** Map process.platform + process.arch to the optional npm package name */
const platformPackages = {
  'linux-x64':   '@claude-code-fork/cli-linux-x64',
  'darwin-arm64': '@claude-code-fork/cli-darwin-arm64',
  'darwin-x64':  '@claude-code-fork/cli-darwin-x64',
  'win32-x64':   '@claude-code-fork/cli-win32-x64',
};

function resolveBinaryFromPackage(pkgName) {
  try {
    // resolve() returns the path to the package.json inside the optional dep
    const pkgJsonPath = require.resolve(`${pkgName}/package.json`);
    return join(dirname(pkgJsonPath), binaryName);
  } catch {
    return null;
  }
}

const platformKey = `${process.platform}-${process.arch}`;
const pkgName = platformPackages[platformKey];

let binaryPath = pkgName ? resolveBinaryFromPackage(pkgName) : null;

// Fallback: local dist/ directory (useful during development / bun run build)
if (!binaryPath || !existsSync(binaryPath)) {
  const localBinary = join(__dirname, '..', 'dist', isWindows ? 'cli.exe' : 'cli');
  if (existsSync(localBinary)) {
    binaryPath = localBinary;
  } else {
    binaryPath = null;
  }
}

if (!binaryPath) {
  process.stderr.write(
    `[claude-code-fork] No binary found for platform "${platformKey}".\n` +
    `Try reinstalling: npm install -g @claude-code-fork/claude-code\n`,
  );
  process.exit(1);
}

const result = spawnSync(binaryPath, process.argv.slice(2), {
  stdio: 'inherit',
  windowsHide: false,
});

if (result.error) {
  process.stderr.write(
    `[claude-code-fork] Could not launch ${binaryPath}: ${result.error.message}\n`,
  );
  process.exit(1);
}

process.exit(result.status ?? 0);
