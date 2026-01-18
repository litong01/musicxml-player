#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Determine version from various sources
function getBuildVersion() {
  // 1. Use BUILD_VERSION env var (set during Docker build or manually)
  if (process.env.BUILD_VERSION) {
    return process.env.BUILD_VERSION;
  }

  // 2. Try reading BUILD_VERSION file (created during Docker build)
  try {
    const versionFile = join(__dirname, '..', 'BUILD_VERSION');
    const version = readFileSync(versionFile, 'utf8').trim();
    if (version) {
      return version;
    }
  } catch (e) {
    // File doesn't exist
  }

  // 3. For local development: try git hash
  try {
    const gitHash = execSync('git rev-parse --short HEAD', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    }).trim();
    if (gitHash) {
      return gitHash;
    }
  } catch (e) {
    // Git not available
  }

  // 4. Fallback: timestamp (ensures fresh cache on every restart)
  return Date.now().toString();
}

const BUILD_VERSION = getBuildVersion();
const SERVICE_WORKER_PATH = join(__dirname, 'service-worker.js');

// Service worker is not needed for Capacitor native apps
// Skip version injection if the file doesn't exist
if (existsSync(SERVICE_WORKER_PATH)) {
  console.log(`Injecting version: ${BUILD_VERSION} into service worker...`);

  let content = readFileSync(SERVICE_WORKER_PATH, 'utf8');

  // Replace the CACHE_NAME constant
  content = content.replace(
    /const CACHE_NAME = 'musicxml-player-v[^']+';/,
    `const CACHE_NAME = 'musicxml-player-v${BUILD_VERSION}';`,
  );

  writeFileSync(SERVICE_WORKER_PATH, content, 'utf8');
} else {
  console.log('Service worker not found (skipped for native app build)');
}

console.log(
  `✅ Service worker version updated to: musicxml-player-v${BUILD_VERSION}`,
);
