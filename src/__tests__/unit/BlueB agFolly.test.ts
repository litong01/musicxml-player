import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { XMLParser } from 'fast-xml-parser';
import { SaxonJSProcessor } from '../../SaxonJSProcessor';
import { unrollMusicXml } from '../../helpers/unroll-musicxml';
import { AccompanimentConverter } from '../../AccompanimentConverter';
import { Midi } from '@tonejs/midi';

describe('Blue Bag Folly - Measure Analysis', () => {
  const blueBagPath = join(
    __dirname,
    '../../../demo/data/blue-bag-folly.musicxml',
  );
  const originalXml = readFileSync(blueBagPath, 'utf-8');

  it('should analyze original measure structure', () => {
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
    });
    const xmlDoc = parser.parse(originalXml);
    const scorePartwise = xmlDoc['score-partwise'];
    const parts = Array.isArray(scorePartwise.part)
      ? scorePartwise.part
      : [scorePartwise.part];
    const measures = Array.isArray(parts[0].measure)
      ? parts[0].measure
      : [parts[0].measure];

    console.log(`\nOriginal XML: ${measures.length} measures`);

    // Find repeats and endings
    const repeats: { type: string; measure: number; index: number }[] = [];
    const endings: { number: string; measure: number; type: string }[] = [];
    const jumps: { type: string; measure: number }[] = [];

    measures.forEach((measure, idx) => {
      const measureNum = Number(measure['@_number']);

      if (measure.barline) {
        const barlines = Array.isArray(measure.barline)
          ? measure.barline
          : [measure.barline];
        barlines.forEach((barline) => {
          if (barline.repeat) {
            const direction = barline.repeat['@_direction'];
            repeats.push({
              type: direction,
              measure: measureNum,
              index: idx,
            });
            console.log(
              `  Repeat ${direction} at measure ${measureNum} (index ${idx})`,
            );
          }
          if (barline.ending) {
            endings.push({
              number: barline.ending['@_number'],
              measure: measureNum,
              type: barline.ending['@_type'],
            });
            console.log(
              `  Ending ${barline.ending['@_number']} (${barline.ending['@_type']}) at measure ${measureNum}`,
            );
          }
        });
      }

      // Check for jumps (segno, coda, dal segno, etc.)
      if (measure.direction) {
        const directions = Array.isArray(measure.direction)
          ? measure.direction
          : [measure.direction];
        directions.forEach((direction) => {
          if (direction.sound) {
            if (direction.sound['@_segno']) {
              jumps.push({ type: 'segno', measure: measureNum });
              console.log(`  Segno at measure ${measureNum}`);
            }
            if (direction.sound['@_dalsegno']) {
              jumps.push({ type: 'dalsegno', measure: measureNum });
              console.log(`  Dal Segno at measure ${measureNum}`);
            }
            if (direction.sound['@_coda']) {
              jumps.push({ type: 'coda', measure: measureNum });
              console.log(`  Coda at measure ${measureNum}`);
            }
            if (direction.sound['@_tocoda']) {
              jumps.push({ type: 'tocoda', measure: measureNum });
              console.log(`  To Coda at measure ${measureNum}`);
            }
          }
        });
      }
    });

    console.log(
      `\nSummary: ${measures.length} measures, ${repeats.length} repeats, ${endings.length} endings, ${jumps.length} jumps`,
    );

    expect(measures.length).toBe(27);
  });

  it('should analyze unrolled measure structure', async () => {
    const processor = new SaxonJSProcessor();
    // Use the same URL as the browser
    const unrollXslUri =
      'https://raw.githubusercontent.com/infojunkie/musicxml-midi/main/build/unroll.sef.json';

    const unrolled = await unrollMusicXml(originalXml, unrollXslUri, processor);

    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
    });
    const xmlDoc = parser.parse(unrolled);
    const scorePartwise = xmlDoc['score-partwise'];
    const parts = Array.isArray(scorePartwise.part)
      ? scorePartwise.part
      : [scorePartwise.part];
    const measures = Array.isArray(parts[0].measure)
      ? parts[0].measure
      : [parts[0].measure];

    console.log(`\nUnrolled XML: ${measures.length} measures`);

    // Show the full sequence: position=originalMeasureNumber
    console.log('Full measure sequence (position=originalMeasure):');
    const sequence = measures.map((m: any, idx: number) => {
      const num = m['@_number'];
      return `${idx + 1}=${num}`;
    });

    // Log in groups of 10 for readability
    for (let i = 0; i < sequence.length; i += 10) {
      console.log(`  ${sequence.slice(i, i + 10).join(', ')}`);
    }

    // Find tempo changes
    const tempoChanges: { position: number; measure: number; bpm: number }[] =
      [];
    measures.forEach((measure: any, idx: number) => {
      if (measure.direction) {
        const directions = Array.isArray(measure.direction)
          ? measure.direction
          : [measure.direction];
        directions.forEach((direction: any) => {
          if (direction.sound?.['@_tempo']) {
            tempoChanges.push({
              position: idx + 1,
              measure: Number(measure['@_number']),
              bpm: Number(direction.sound['@_tempo']),
            });
          }
        });
      }
    });

    console.log(`\nTempo changes in unrolled score:`);
    tempoChanges.forEach((change) => {
      console.log(
        `  Position ${change.position} (original measure ${change.measure}): ${change.bpm} BPM`,
      );
    });

    // We expect 52 measures based on browser output
    expect(measures.length).toBe(52);
    expect(tempoChanges.length).toBeGreaterThan(0);
  });

  it('should generate MIDI with tempo changes from Blue Bag Folly', async () => {
    const converter = new AccompanimentConverter();

    await converter.initialize(originalXml, {
      bandEnergy: 'medium',
      outputMode: 'band-only',
      unrollXslUri:
        'https://raw.githubusercontent.com/infojunkie/musicxml-midi/main/build/unroll.sef.json',
      timemapXslUri:
        'https://raw.githubusercontent.com/infojunkie/musicxml-midi/main/build/timemap.sef.json',
      xsltProcessor: new SaxonJSProcessor(),
    });

    console.log('\n[Test] Converter initialized successfully');

    const midiData = converter.midi;
    expect(midiData).toBeDefined();
    expect(midiData.byteLength).toBeGreaterThan(0);

    console.log(`[Test] MIDI generated: ${midiData.byteLength} bytes`);

    // Parse the MIDI to check tempo events
    const midi = new Midi(midiData);

    console.log(`[Test] MIDI header tempos: ${midi.header.tempos.length}`);
    console.log('[Test] Tempo events:');
    midi.header.tempos.forEach((tempo, idx) => {
      console.log(
        `  ${idx}: ticks=${tempo.ticks}, bpm=${tempo.bpm}, time=${tempo.time}s`,
      );
    });

    // With the new approach: notes use variable tempo (from normalized measures)
    // but MIDI header uses constant tempo to avoid double-tempo application
    // We expect only 1 tempo event (the constant 120 BPM)
    expect(midi.header.tempos.length).toBe(1);

    // Verify initial tempo is 120 BPM (constant)
    expect(midi.header.tempos[0].bpm).toBe(120);
    expect(midi.header.tempos[0].ticks).toBe(0);

    console.log('[Test] MIDI tempo events validated successfully');
  });
});
