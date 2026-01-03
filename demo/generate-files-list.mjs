#!/usr/bin/env node
import { readdir, writeFile } from 'fs/promises';
import { join } from 'path';

/**
 * Scans the demo/data directory for MusicXML files and generates files.json
 */
async function generateFilesList() {
  try {
    const dataDir = join(process.cwd(), 'demo', 'data');
    const files = await readdir(dataDir);

    // Filter for .musicxml and .mxl files
    const musicFiles = files
      .filter((file) => /\.(musicxml|mxl)$/i.test(file))
      .sort();

    console.log(`Found ${musicFiles.length} MusicXML files in demo/data/`);

    // Write to files.json
    const outputPath = join(dataDir, 'files.json');
    await writeFile(outputPath, JSON.stringify(musicFiles, null, 2), 'utf8');

    console.log(`Generated ${outputPath}`);
  } catch (error) {
    console.error('Error generating files list:', error);
    process.exit(1);
  }
}

generateFilesList();
