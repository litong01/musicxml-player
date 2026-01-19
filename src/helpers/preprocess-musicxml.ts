import { XMLParser } from 'fast-xml-parser';
import { removeFermatas } from './remove-fermatas';

export interface MusicXmlMetadata {
  tempo: number;
  timeSignature: [number, number];
  tempoChanges: Array<{ measure: number; bpm: number }>;
  timeSignatureChanges: Array<{
    measure: number;
    beats: number;
    beatType: number;
  }>;
}

export interface PreprocessResult {
  musicXml: string;
  metadata: MusicXmlMetadata;
}

/**
 * Preprocess MusicXML to fix common issues:
 * 1. Remove fermatas (cause timing issues)
 * 2. Add missing tempo (default to 120 BPM if none exists)
 * 3. Extract all tempo changes
 * 4. Extract all time signature changes
 */
export function preprocessMusicXml(musicXml: string): PreprocessResult {
  // Step 1: Remove fermatas
  const cleaned = removeFermatas(musicXml);

  // Step 2: Parse the XML
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    parseAttributeValue: false,
  });
  const xmlDoc = parser.parse(cleaned);

  // Step 3: Extract metadata and add missing tempo
  const metadata: MusicXmlMetadata = {
    tempo: 120,
    timeSignature: [4, 4],
    tempoChanges: [],
    timeSignatureChanges: [],
  };

  let hasInitialTempo = false;
  let currentMeasureNumber = 0;

  try {
    const scorePartwise = xmlDoc['score-partwise'];
    if (!scorePartwise) return { musicXml: cleaned, metadata };

    const parts = Array.isArray(scorePartwise.part)
      ? scorePartwise.part
      : [scorePartwise.part];

    // Process first part only for metadata
    const part = parts[0];
    if (part?.measure) {
      const measures = Array.isArray(part.measure)
        ? part.measure
        : [part.measure];

      for (const measure of measures) {
        currentMeasureNumber++;

        // Check for time signature changes
        if (measure.attributes?.time) {
          const time = measure.attributes.time;
          const beats = Number(time.beats);
          const beatType = Number(time['beat-type']);

          if (currentMeasureNumber === 1) {
            metadata.timeSignature = [beats, beatType];
          } else {
            metadata.timeSignatureChanges.push({
              measure: currentMeasureNumber,
              beats,
              beatType,
            });
          }
        }

        // Check for tempo markings
        if (measure.direction) {
          const directions = Array.isArray(measure.direction)
            ? measure.direction
            : [measure.direction];

          for (const direction of directions) {
            if (direction.sound?.['@_tempo']) {
              const bpm = Number(direction.sound['@_tempo']);

              if (currentMeasureNumber === 1 || !hasInitialTempo) {
                metadata.tempo = bpm;
                hasInitialTempo = true;
              } else {
                metadata.tempoChanges.push({
                  measure: currentMeasureNumber,
                  bpm,
                });
              }
            }
          }
        }
      }
    }

    // Don't modify XML - just extract metadata
    // Converters will handle missing tempo with defaults
  } catch {
    // Ignore errors in metadata extraction
  }

  return { musicXml: cleaned, metadata };
}
