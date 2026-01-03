import { XMLParser, XMLBuilder } from 'fast-xml-parser';

/**
 * Normalize MusicXML by ensuring each measure has explicit tempo and time signature.
 * Tempo is assigned based on ORIGINAL measure numbers (from @_number attribute),
 * not sequential position, to handle repeats correctly.
 */
export function normalizeMeasures(
  musicXml: string,
  originalMusicXml: string,
): string {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    parseAttributeValue: true,
    trimValues: true,
  });

  // Extract tempo map from ORIGINAL XML
  const tempoMap = extractTempoMap(originalMusicXml, parser);

  const xmlDoc = parser.parse(musicXml);
  const scorePartwise = xmlDoc['score-partwise'];

  if (!scorePartwise) {
    return musicXml;
  }

  // Get parts
  const parts = Array.isArray(scorePartwise.part)
    ? scorePartwise.part
    : [scorePartwise.part];

  // Process each part
  for (const part of parts) {
    if (!part || !part.measure) continue;

    const measures = Array.isArray(part.measure)
      ? part.measure
      : [part.measure];

    let currentDivisions: number | null = null;
    let previousTempo: number | null = null;
    const tempoCounts = { removed: 0, added: 0 };

    for (const measure of measures) {
      if (!measure) continue;

      // Get original measure number
      const measureNumber = measure['@_number']
        ? Number(measure['@_number'])
        : 0;

      // Track and propagate divisions
      if (measure.attributes?.divisions) {
        currentDivisions = Number(measure.attributes.divisions);
      } else if (currentDivisions) {
        if (!measure.attributes) measure.attributes = {};
        measure.attributes.divisions = currentDivisions;
      }

      // Determine tempo based on original measure number
      const tempo = getTempoForMeasure(measureNumber, tempoMap);

      // FIRST: Remove ALL existing tempo directions to avoid duplicates
      if (measure.direction) {
        const directions = Array.isArray(measure.direction)
          ? measure.direction
          : [measure.direction];

        // Filter out tempo directions
        const hadTempo = directions.some((dir: any) => dir?.sound?.['@_tempo']);
        if (hadTempo) tempoCounts.removed++;

        const filtered = directions.filter(
          (dir: any) => !dir?.sound?.['@_tempo'],
        );

        if (filtered.length === 0) {
          delete measure.direction;
        } else if (filtered.length === 1) {
          measure.direction = filtered[0];
        } else {
          measure.direction = filtered;
        }
      }

      // SECOND: Add tempo ONLY if it changed from previous measure
      if (tempo && tempo !== previousTempo) {
        tempoCounts.added++;
        // Ensure direction exists
        if (!measure.direction) {
          measure.direction = {
            sound: { '@_tempo': tempo },
          };
        } else {
          // Add tempo to existing directions
          const directions = Array.isArray(measure.direction)
            ? measure.direction
            : [measure.direction];

          directions.unshift({ sound: { '@_tempo': tempo } });
          measure.direction = directions;
        }
        previousTempo = tempo;
      } else if (tempo) {
        // Tempo didn't change, just track it
        previousTempo = tempo;
      }
    }
  }

  const builder = new XMLBuilder({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    format: false,
    suppressEmptyNode: true,
  });

  return builder.build(xmlDoc);
}

/**
 * Extract tempo map from original MusicXML
 * Returns a map of measure number -> BPM
 */
function extractTempoMap(musicXml: string, parser: any): Map<number, number> {
  const tempoMap = new Map<number, number>();
  const xmlDoc = parser.parse(musicXml);
  const scorePartwise = xmlDoc['score-partwise'];

  if (!scorePartwise?.part) return tempoMap;

  const parts = Array.isArray(scorePartwise.part)
    ? scorePartwise.part
    : [scorePartwise.part];

  // Process first part only
  const part = parts[0];
  if (!part?.measure) return tempoMap;

  const measures = Array.isArray(part.measure) ? part.measure : [part.measure];

  let initialTempo = 120; // Default
  let currentMeasureNumber = 0;

  for (const measure of measures) {
    currentMeasureNumber++;

    // Check for tempo in this measure
    if (measure.direction) {
      const directions = Array.isArray(measure.direction)
        ? measure.direction
        : [measure.direction];

      for (const direction of directions) {
        if (direction?.sound?.['@_tempo']) {
          const tempo = Number(direction.sound['@_tempo']);
          if (currentMeasureNumber === 1) {
            initialTempo = tempo;
          }
          tempoMap.set(currentMeasureNumber, tempo);
        }
      }
    }
  }

  // If no initial tempo was set, add it
  if (!tempoMap.has(1)) {
    tempoMap.set(1, initialTempo);
  }

  return tempoMap;
}

/**
 * Get tempo for a measure based on tempo map
 * Returns the most recent tempo at or before this measure
 */
function getTempoForMeasure(
  measureNumber: number,
  tempoMap: Map<number, number>,
): number {
  // Find the most recent tempo change at or before this measure
  let tempo = 120; // Default
  const sortedMeasures = Array.from(tempoMap.keys()).sort((a, b) => a - b);

  for (const m of sortedMeasures) {
    if (m <= measureNumber) {
      tempo = tempoMap.get(m)!;
    } else {
      break;
    }
  }

  return tempo;
}
