import { Midi } from '@tonejs/midi';
import type {
  IMIDIConverter,
  MeasureTimemap,
} from './interfaces/IMIDIConverter';
import type { PlayerOptions } from './Player';
import { assertIsDefined, normalizeMeasures, unrollMusicXml } from './helpers';
import pkg from '../package.json';
import { XMLParser } from 'fast-xml-parser';

export interface AccompanimentOptions {
  introMode?: 'auto' | 'always' | 'none';
  introIntensity?: 'soft' | 'medium' | 'strong';
  bandEnergy?: 'soft' | 'medium' | 'strong';
  outputMode?: 'solo-only' | 'band-only' | 'solo-and-band';
  drummerPracticeMode?: boolean;
}

interface Note {
  pitch: number; // MIDI note number
  time: number; // in seconds
  duration: number; // in seconds
  velocity: number;
}

interface Chord {
  root: number; // MIDI note number (0-11)
  type: 'major' | 'minor' | 'diminished' | 'dominant7';
  time: number;
  duration: number;
}

/**
 * Implementation of IMIDIConverter that generates accompaniment tracks (piano, bass, drums)
 * from a MusicXML score.
 */
export class AccompanimentConverter implements IMIDIConverter {
  protected _midi?: ArrayBuffer;
  protected _timemap?: MeasureTimemap;
  protected _unrolledMusicXml?: string;
  protected _options: Required<AccompanimentOptions>;

  constructor(options: AccompanimentOptions = {}) {
    this._options = {
      introMode: options.introMode ?? 'auto',
      introIntensity: options.introIntensity ?? 'medium',
      bandEnergy: options.bandEnergy ?? 'medium',
      outputMode: options.outputMode ?? 'solo-and-band',
      drummerPracticeMode: options.drummerPracticeMode ?? true,
    };
  }

  async initialize(
    musicXml: string,
    options: Required<PlayerOptions>,
  ): Promise<void> {
    // Always unroll the MusicXML to expand repeats for MIDI generation
    const unrolled = await unrollMusicXml(
      musicXml,
      options.unrollXslUri,
      options.xsltProcessor,
    );
    if ((unrolled.match(/<note[\s>]/g) || []).length > 0) {
      this._unrolledMusicXml = unrolled; // Store for renderer
    }

    // Normalize the unrolled XML to propagate tempo through all measures
    // normalizeMeasures(toNormalize, tempoSource)
    const normalizedUnrolled = normalizeMeasures(unrolled, musicXml);

    // Parse the normalized unrolled XML to generate our own timemap
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
    });
    const normalizedXmlDoc = parser.parse(normalizedUnrolled);

    // Generate timemap from normalized unrolled XML
    console.log(
      '[AccompanimentConverter] Generating timemap from normalized unrolled XML',
    );
    this._timemap = this._generateTimemapFromXML(normalizedXmlDoc);
    console.log(
      `[AccompanimentConverter] Timemap generated: ${this._timemap.length} entries`,
    );

    // Extract tempo from ORIGINAL MusicXML (for reference only)
    const originalXmlDoc = parser.parse(musicXml);
    const { tempo: initialTempo } = this._extractTempoMetadata(originalXmlDoc);

    // Parse the NORMALIZED UNROLLED MusicXML for note extraction
    const unrolledXmlDoc = parser.parse(normalizedUnrolled);

    // Extract tempo changes from NORMALIZED UNROLLED XML
    // This has the correct tempo flow considering repeats
    const unrolledTempoChanges =
      this._extractTempoChangesFromUnrolled(unrolledXmlDoc);

    console.log(
      `[AccompanimentConverter] Extracted ${unrolledTempoChanges.length} tempo change(s) from normalized unrolled XML`,
    );

    // DEBUG: Log measure count and structure
    const scorePartwise = unrolledXmlDoc['score-partwise'];
    if (scorePartwise && scorePartwise.part) {
      const parts = Array.isArray(scorePartwise.part)
        ? scorePartwise.part
        : [scorePartwise.part];
      if (parts[0] && parts[0].measure) {
        const measures = Array.isArray(parts[0].measure)
          ? parts[0].measure
          : [parts[0].measure];
        console.log(
          `[AccompanimentConverter] Unrolled XML has ${measures.length} measures`,
        );
      }
    }

    // Extract melody notes from UNROLLED and NORMALIZED XML
    // Each measure has explicit tempo from normalization
    const { notes, isPercussion } = this._extractNotes(
      unrolledXmlDoc,
      initialTempo,
    );

    // Debug: Check note timeline
    if (notes.length > 0) {
      const lastNote = notes[notes.length - 1];
      const notesEndTime = lastNote.time + lastNote.duration;
      console.log(
        `[AccompanimentConverter] Notes timeline: first note at ${notes[0].time.toFixed(2)}s, last note ends at ${notesEndTime.toFixed(2)}s`,
      );
      console.log(
        `[AccompanimentConverter] Total notes generated: ${notes.length}`,
      );

      // Find notes around measure 14-15 (37-42 seconds)
      const notesInRange = notes.filter((n) => n.time >= 35 && n.time <= 45);
      console.log(
        `[AccompanimentConverter] Notes between 35-45s: ${notesInRange.length} notes`,
      );
      if (notesInRange.length > 0) {
        console.log(
          `[AccompanimentConverter] First note in range: time=${notesInRange[0].time.toFixed(2)}s, duration=${notesInRange[0].duration.toFixed(2)}s`,
        );
        console.log(
          `[AccompanimentConverter] Last note in range: time=${notesInRange[notesInRange.length - 1].time.toFixed(2)}s, duration=${notesInRange[notesInRange.length - 1].duration.toFixed(2)}s`,
        );
      }
    } else {
      console.warn('[AccompanimentConverter] No notes extracted!');
    }

    // Map tempo changes from unrolled XML to timemap positions
    const tempo = initialTempo;
    const tempoChanges: Array<{
      time: number;
      bpm: number;
      measure: number;
      position: number;
    }> = [];

    for (const change of unrolledTempoChanges) {
      // Find the timemap entry at this POSITION (0-indexed in measures array)
      // Timemap appears to be 1-indexed or has measure 0 at index 0, so we need +1 offset
      const timemapIndex = change.position + 1;
      if (timemapIndex >= 0 && timemapIndex < this._timemap.length) {
        const timemapEntry = this._timemap[timemapIndex];
        console.log(
          `[AccompanimentConverter] Tempo change at array position ${change.position} → timemap[${timemapIndex}]: ${change.bpm} BPM, measure ${timemapEntry.measure} at ${(timemapEntry.timestamp / 1000).toFixed(2)}s`,
        );
        tempoChanges.push({
          time: timemapEntry.timestamp / 1000, // Convert ms to seconds
          bpm: change.bpm,
          measure: timemapEntry.measure,
          position: timemapIndex,
        });
      } else {
        console.warn(
          `[AccompanimentConverter] No timemap entry at index ${timemapIndex} (array position ${change.position})`,
        );
      }
    }

    // Sort tempo changes by time to ensure they're in chronological order
    tempoChanges.sort((a, b) => a.time - b.time);

    // PHASE 2: Log tempo changes
    if (tempoChanges.length > 0) {
      console.log(
        `[AccompanimentConverter] Using ${tempoChanges.length} tempo change(s):`,
      );
      tempoChanges.forEach((change) => {
        console.log(
          `  Position ${change.position} - Measure ${change.measure} (${change.time.toFixed(2)}s): ${change.bpm} BPM`,
        );
      });
    } else {
      console.log(
        `[AccompanimentConverter] No tempo changes detected. Using ${tempo} BPM throughout.`,
      );
    }

    // DEBUG: Log timemap entries around measure 14-15 to analyze tempo
    console.log('[AccompanimentConverter] Timemap entries for measures 13-16:');
    for (let m = 13; m <= 16; m++) {
      const entries = this._timemap.filter((e) => e.measure === m);
      entries.forEach((e) => {
        console.log(
          `  Measure ${e.measure}: ${(e.timestamp / 1000).toFixed(2)}s, duration ${(e.duration / 1000).toFixed(2)}s`,
        );
      });
    }

    // Detect key signature
    const keySignature = this._detectKey(unrolledXmlDoc, notes);

    // Generate chord progression
    const chords = this._generateChords(
      notes,
      keySignature,
      isPercussion,
      tempo,
    );

    // Create MIDI with accompaniment
    this._midi = this._createMidiWithAccompaniment(
      notes,
      chords,
      tempo,
      tempoChanges,
      isPercussion,
    );

    // Parse the generated MIDI to get the true duration
    const midiArray = new Uint8Array(this._midi);
    const midi = new Midi(midiArray);
    const actualMidiDuration = midi.duration;

    console.log(
      `[AccompanimentConverter] MIDI duration: ${actualMidiDuration.toFixed(2)}s`,
    );

    if (this._timemap.length > 0) {
      const lastEntry = this._timemap[this._timemap.length - 1];
      const timemapTotalDuration =
        (lastEntry.timestamp + lastEntry.duration) / 1000;

      console.log(
        `[AccompanimentConverter] Timemap total duration: ${timemapTotalDuration.toFixed(2)}s`,
      );

      if (Math.abs(actualMidiDuration - timemapTotalDuration) > 1) {
        console.warn(
          `[AccompanimentConverter] WARNING: MIDI duration (${actualMidiDuration.toFixed(2)}s) differs from timemap (${timemapTotalDuration.toFixed(2)}s) by ${Math.abs(actualMidiDuration - timemapTotalDuration).toFixed(2)}s`,
        );
      } else {
        console.log(
          `[AccompanimentConverter] MIDI and timemap durations match within tolerance`,
        );
      }

      // Ensure timemap covers the full MIDI duration
      const lastEntryAfterScale = this._timemap[this._timemap.length - 1];
      const timemapEndTime =
        (lastEntryAfterScale.timestamp + lastEntryAfterScale.duration) / 1000;

      if (timemapEndTime < actualMidiDuration - 0.1) {
        // Extend the last entry's duration to cover the full MIDI
        lastEntryAfterScale.duration =
          actualMidiDuration * 1000 - lastEntryAfterScale.timestamp;
      }
    }
  }

  /**
   * Extract tempo metadata from ORIGINAL MusicXML (before unrolling)
   * Returns initial tempo and tempo changes with measure numbers only
   */
  private _extractTempoMetadata(xmlDoc: any): {
    tempo: number;
    tempoChanges: Array<{ bpm: number; measure: number }>;
  } {
    let initialTempo = 120; // Default tempo (returned)
    let currentTempo = 120; // Track current tempo for comparison
    const tempoChanges: Array<{ bpm: number; measure: number }> = [];
    let foundInitialTempo = false;

    try {
      const scorePartwise = xmlDoc['score-partwise'];
      if (!scorePartwise) return { tempo: initialTempo, tempoChanges };

      const parts = Array.isArray(scorePartwise.part)
        ? scorePartwise.part
        : [scorePartwise.part];

      // Only process the first part
      const part = parts[0];
      if (part && part.measure) {
        const partMeasures = Array.isArray(part.measure)
          ? part.measure
          : [part.measure];

        for (let i = 0; i < partMeasures.length; i++) {
          const measure = partMeasures[i];
          if (!measure) continue;

          const measureNumber = measure['@_number']
            ? Number(measure['@_number'])
            : i + 1;

          // Check for tempo changes
          if (measure.direction) {
            const directions = Array.isArray(measure.direction)
              ? measure.direction
              : [measure.direction];

            for (const direction of directions) {
              if (direction.sound && direction.sound['@_tempo']) {
                const newTempo = Number(direction.sound['@_tempo']);
                if (!foundInitialTempo) {
                  // First tempo marking found - set as initial tempo
                  initialTempo = newTempo;
                  currentTempo = newTempo;
                  foundInitialTempo = true;
                  console.log(
                    `[AccompanimentConverter] Initial tempo: ${initialTempo} BPM at measure ${measureNumber}`,
                  );
                } else if (newTempo !== currentTempo) {
                  // Tempo change detected
                  tempoChanges.push({
                    bpm: newTempo,
                    measure: measureNumber,
                  });
                  console.log(
                    `[AccompanimentConverter] Tempo change: ${newTempo} BPM at measure ${measureNumber}`,
                  );
                  currentTempo = newTempo;
                }
              }
            }
          }
        }
      }
    } catch (error) {
      console.error(
        '[AccompanimentConverter] Error extracting tempo metadata:',
        error,
      );
    }

    console.log(
      `[AccompanimentConverter] Extracted tempo metadata from original: ${initialTempo} BPM (initial), ${tempoChanges.length} change(s)`,
    );
    return { tempo: initialTempo, tempoChanges };
  }

  /**
   * Extract tempo changes from unrolled and normalized XML.
   * Returns tempo changes with their POSITION in the unrolled sequence.
   */
  private _extractTempoChangesFromUnrolled(xmlDoc: any): Array<{
    bpm: number;
    position: number;
  }> {
    const tempoChanges: Array<{ bpm: number; position: number }> = [];
    let previousTempo: number | null = null;

    try {
      const scorePartwise = xmlDoc['score-partwise'];
      if (!scorePartwise) return tempoChanges;

      const parts = Array.isArray(scorePartwise.part)
        ? scorePartwise.part
        : [scorePartwise.part];

      // Only process the first part
      const part = parts[0];
      if (part && part.measure) {
        const partMeasures = Array.isArray(part.measure)
          ? part.measure
          : [part.measure];

        for (let position = 0; position < partMeasures.length; position++) {
          const measure = partMeasures[position];
          if (!measure) continue;

          // Check for tempo in this measure
          if (measure.direction) {
            const directions = Array.isArray(measure.direction)
              ? measure.direction
              : [measure.direction];

            for (const direction of directions) {
              if (direction.sound && direction.sound['@_tempo']) {
                const tempo = Number(direction.sound['@_tempo']);

                // Only record if tempo changed
                if (previousTempo === null || tempo !== previousTempo) {
                  tempoChanges.push({
                    bpm: tempo,
                    position: position,
                  });
                  previousTempo = tempo;
                }
                break; // Only take first tempo in measure
              }
            }
          }
        }
      }
    } catch (error) {
      console.error(
        '[AccompanimentConverter] Error extracting tempo from unrolled XML:',
        error,
      );
    }

    return tempoChanges;
  }

  /**
   * Generate a timemap from normalized unrolled XML.
   * Creates continuous timeline with proper tempo-based durations.
   */
  private _generateTimemapFromXML(xmlDoc: any): MeasureTimemap {
    const timemap: MeasureTimemap = [];
    let currentTime = 0; // in milliseconds

    try {
      const scorePartwise = xmlDoc['score-partwise'];
      if (!scorePartwise) return timemap;

      const parts = Array.isArray(scorePartwise.part)
        ? scorePartwise.part
        : [scorePartwise.part];

      if (!parts[0] || !parts[0].measure) return timemap;

      const measures = Array.isArray(parts[0].measure)
        ? parts[0].measure
        : [parts[0].measure];

      let currentTempo = 120; // Default tempo

      for (let i = 0; i < measures.length; i++) {
        const measure = measures[i];
        if (!measure) continue;

        // Get measure number (0-based for timemap)
        const measureNumber = measure['@_number']
          ? Number(measure['@_number']) - 1
          : i;

        // Check for tempo change in this measure
        if (measure.direction) {
          const directions = Array.isArray(measure.direction)
            ? measure.direction
            : [measure.direction];

          for (const direction of directions) {
            if (direction.sound && direction.sound['@_tempo']) {
              currentTempo = Number(direction.sound['@_tempo']);
              break;
            }
          }
        }

        // Get time signature from attributes
        let timeBeats = 4;
        let beatType = 4;
        if (measure.attributes?.time) {
          timeBeats = Number(measure.attributes.time.beats);
          beatType = Number(measure.attributes.time['beat-type']);
        }

        // Calculate measure duration in milliseconds
        // Duration = (beats / beat_type) * 4 quarter notes * (60000ms/tempo)
        const quarterNotes = (timeBeats / beatType) * 4;
        const msPerQuarterNote = 60000 / currentTempo;
        const measureDuration = Math.round(quarterNotes * msPerQuarterNote);

        timemap.push({
          measure: measureNumber,
          timestamp: currentTime,
          duration: measureDuration,
        });

        currentTime += measureDuration;
      }
    } catch (error) {
      console.error(
        '[AccompanimentConverter] Error generating timemap:',
        error,
      );
    }

    return timemap;
  }

  /**
   * Extract notes from parsed MusicXML (UNROLLED and NORMALIZED version)
   * Each measure already has explicit tempo thanks to normalization
   */
  private _extractNotes(
    xmlDoc: any,
    _initialTempo: number,
  ): {
    notes: Note[];
    isPercussion: boolean;
  } {
    const notes: Note[] = [];
    let divisions = 1;
    let isPercussion = false;

    try {
      // Navigate to score-partwise structure
      const scorePartwise = xmlDoc['score-partwise'];
      if (!scorePartwise) return { notes, isPercussion };

      // Get part list to check for percussion
      const partList = scorePartwise['part-list'];
      if (partList && partList['score-part']) {
        const scoreParts = Array.isArray(partList['score-part'])
          ? partList['score-part']
          : [partList['score-part']];

        for (const part of scoreParts) {
          const partName = part['part-name'];
          if (
            typeof partName === 'string' &&
            (partName.toLowerCase().includes('drum') ||
              partName.toLowerCase().includes('percussion'))
          ) {
            isPercussion = true;
          }
        }
      }

      // Get parts - only use the first part for melody extraction
      const parts = Array.isArray(scorePartwise.part)
        ? scorePartwise.part
        : [scorePartwise.part];

      // Only process the first part (melody line)
      const part = parts[0];
      if (part && part.measure) {
        const partMeasures = Array.isArray(part.measure)
          ? part.measure
          : [part.measure];

        for (let i = 0; i < partMeasures.length; i++) {
          const measure = partMeasures[i];
          if (!measure) continue;

          // Get the timemap entry for this position
          if (!this._timemap || i >= this._timemap.length) {
            console.warn(
              `[AccompanimentConverter] No timemap entry for position ${i}`,
            );
            continue;
          }
          const timemapEntry = this._timemap[i];

          const measureStartTime = timemapEntry.timestamp / 1000; // Convert ms to seconds
          const measureDuration = timemapEntry.duration / 1000; // Convert ms to seconds

          // Get divisions from attributes
          if (measure.attributes?.divisions) {
            divisions = Number(measure.attributes.divisions);
          }

          // Get measure duration in quarter notes from time signature or default to 4
          let measureQuarters = 4;
          if (measure.attributes?.time) {
            const timeBeats = Number(measure.attributes.time.beats);
            const beatType = Number(measure.attributes.time['beat-type']);
            measureQuarters = (timeBeats / beatType) * 4; // Convert to quarter notes
          }

          // Track position within measure (in quarter notes)
          let positionInMeasure = 0;

          // Measure position logging removed for cleaner output

          // Extract notes from measure
          if (measure.note) {
            const measureNotes = Array.isArray(measure.note)
              ? measure.note
              : [measure.note];

            for (const note of measureNotes) {
              if (!note) continue;

              // Skip if it's a chord note (not the root of the chord)
              if (note.chord) continue;

              const duration = note.duration
                ? Number(note.duration) / divisions
                : 1;

              // Calculate note time based on timemap timing
              // Map the note's position within the measure to actual time
              const noteTime =
                measureStartTime +
                (positionInMeasure / measureQuarters) * measureDuration;
              const noteDurationInSeconds =
                (duration / measureQuarters) * measureDuration;

              // Get pitch
              let pitch = 60; // Default middle C

              if (note.pitch) {
                const step = note.pitch.step;
                const octave = Number(note.pitch.octave);
                const alter = note.pitch.alter ? Number(note.pitch.alter) : 0;

                const stepMap: Record<string, number> = {
                  C: 0,
                  D: 2,
                  E: 4,
                  F: 5,
                  G: 7,
                  A: 9,
                  B: 11,
                };

                pitch = (octave + 1) * 12 + stepMap[step] + alter;
              } else if (note.unpitched) {
                // For unpitched percussion, use a generic note
                pitch = 60;
              } else if (note.rest) {
                // Skip rests but advance position
                positionInMeasure += duration;
                continue;
              }

              notes.push({
                pitch,
                time: noteTime,
                duration: noteDurationInSeconds,
                velocity: 80,
              });

              positionInMeasure += duration;
            }
          }
        }
      }
    } catch (error) {
      console.error('[AccompanimentConverter] Error extracting notes:', error);
    }

    return { notes, isPercussion };
  }

  /**
   * Detect key signature from MusicXML
   */
  private _detectKey(xmlDoc: any, _notes: Note[]): number {
    let fifths = 0; // Default to C major

    try {
      const scorePartwise = xmlDoc['score-partwise'];
      if (!scorePartwise || !scorePartwise.part) return fifths;

      const parts = Array.isArray(scorePartwise.part)
        ? scorePartwise.part
        : [scorePartwise.part];

      for (const part of parts) {
        if (!part || !part.measure) continue;

        const measures = Array.isArray(part.measure)
          ? part.measure
          : [part.measure];

        for (const measure of measures) {
          if (measure.attributes && measure.attributes.key) {
            fifths = Number(measure.attributes.key.fifths) || 0;
            return fifths;
          }
        }
      }
    } catch (error) {
      console.error('[AccompanimentConverter] Error detecting key:', error);
    }

    return fifths;
  }

  /**
   * Generate chord progression based on melody notes
   */
  private _generateChords(
    notes: Note[],
    keyFifths: number,
    isPercussion: boolean,
    tempo: number,
  ): Chord[] {
    const chords: Chord[] = [];

    if (notes.length === 0) return chords;

    // Map fifths to root note (in chromatic scale 0-11)
    const fifthsToRoot: Record<number, number> = {
      '-7': 5, // Cb
      '-6': 0, // Gb
      '-5': 7, // Db
      '-4': 2, // Ab
      '-3': 9, // Eb
      '-2': 4, // Bb
      '-1': 11, // F
      0: 5, // C
      1: 0, // G
      2: 7, // D
      3: 2, // A
      4: 9, // E
      5: 4, // B
      6: 11, // F#
      7: 6, // C#
    };

    const keyRoot = fifthsToRoot[keyFifths] ?? 0;

    // If percussion, generate a simple I-V-vi-IV progression
    if (isPercussion) {
      const totalDuration =
        notes.length > 0
          ? notes[notes.length - 1].time + notes[notes.length - 1].duration
          : 0;
      const chordDuration = (4 * 60) / tempo; // 4 beats

      for (let time = 0; time < totalDuration; time += chordDuration) {
        const chordIndex = Math.floor(time / chordDuration) % 4;
        let root = keyRoot;
        let type: Chord['type'] = 'major';

        switch (chordIndex) {
          case 0:
            root = keyRoot; // I
            type = 'major';
            break;
          case 1:
            root = (keyRoot + 7) % 12; // V
            type = 'major';
            break;
          case 2:
            root = (keyRoot + 9) % 12; // vi
            type = 'minor';
            break;
          case 3:
            root = (keyRoot + 5) % 12; // IV
            type = 'major';
            break;
        }

        chords.push({ root, type, time, duration: chordDuration });
      }

      return chords;
    }

    // For melodic content, analyze notes to infer chords
    const chordDuration = (2 * 60) / tempo; // 2 beats per chord
    const totalDuration =
      notes.length > 0
        ? notes[notes.length - 1].time + notes[notes.length - 1].duration
        : 0;

    for (let time = 0; time < totalDuration; time += chordDuration) {
      // Find notes in this time window
      const windowNotes = notes.filter(
        (n) => n.time >= time && n.time < time + chordDuration,
      );

      if (windowNotes.length === 0) {
        // Use the previous chord or default to I
        if (chords.length > 0) {
          const prev = chords[chords.length - 1];
          chords.push({ ...prev, time, duration: chordDuration });
        } else {
          chords.push({
            root: keyRoot,
            type: 'major',
            time,
            duration: chordDuration,
          });
        }
        continue;
      }

      // Analyze note pitches to determine chord
      const pitchClasses = windowNotes.map((n) => n.pitch % 12);
      const uniquePitches = Array.from(new Set(pitchClasses));

      // Simple chord inference: use most common note as root
      const root = this._findMostLikelyRoot(uniquePitches, keyRoot);
      const type = this._inferChordType(uniquePitches, root);

      chords.push({ root, type, time, duration: chordDuration });
    }

    return chords;
  }

  /**
   * Find most likely chord root from a set of pitch classes
   */
  private _findMostLikelyRoot(pitches: number[], keyRoot: number): number {
    // Prefer diatonic chords in the key
    const diatonicRoots = [
      keyRoot, // I
      (keyRoot + 2) % 12, // ii
      (keyRoot + 4) % 12, // iii
      (keyRoot + 5) % 12, // IV
      (keyRoot + 7) % 12, // V
      (keyRoot + 9) % 12, // vi
    ];

    for (const root of diatonicRoots) {
      if (pitches.includes(root)) return root;
    }

    // Fallback to first pitch
    return pitches[0] || keyRoot;
  }

  /**
   * Infer chord type from pitch classes
   */
  private _inferChordType(pitches: number[], root: number): Chord['type'] {
    const intervals = pitches
      .map((p) => (p - root + 12) % 12)
      .sort((a, b) => a - b);

    // Check for major triad (0, 4, 7)
    if (intervals.includes(4) && intervals.includes(7)) return 'major';

    // Check for minor triad (0, 3, 7)
    if (intervals.includes(3) && intervals.includes(7)) return 'minor';

    // Check for dominant 7th (0, 4, 7, 10)
    if (
      intervals.includes(4) &&
      intervals.includes(7) &&
      intervals.includes(10)
    )
      return 'dominant7';

    // Check for diminished (0, 3, 6)
    if (intervals.includes(3) && intervals.includes(6)) return 'diminished';

    // Default to major
    return 'major';
  }

  /**
   * Create MIDI file with accompaniment tracks
   */
  private _createMidiWithAccompaniment(
    melodyNotes: Note[],
    chords: Chord[],
    tempo: number,
    tempoChanges: Array<{ time: number; bpm: number; measure: number }>,
    isPercussion: boolean,
  ): ArrayBuffer {
    const midi = new Midi();

    // Use constant tempo for now to avoid potential hanging issues
    midi.header.setTempo(tempo);

    console.log(
      `[AccompanimentConverter] MIDI using constant tempo: ${tempo} BPM`,
    );

    if (tempoChanges.length > 0) {
      console.log(
        `[AccompanimentConverter] Note: ${tempoChanges.length} tempo changes detected but not applied to MIDI (using constant ${tempo} BPM)`,
      );
    }

    // Energy settings
    const energyMap = {
      soft: { piano: 0.5, bass: 0.6, strings: 0.4, brass: 0.5, drums: 0.4 },
      medium: { piano: 0.7, bass: 0.75, strings: 0.6, brass: 0.7, drums: 0.6 },
      strong: { piano: 0.85, bass: 0.9, strings: 0.75, brass: 0.9, drums: 0.8 },
    };

    const energy = energyMap[this._options.bandEnergy];

    // Add original melody track (if not band-only mode)
    if (this._options.outputMode !== 'band-only' && !isPercussion) {
      const melodyTrack = midi.addTrack();
      melodyTrack.name = 'Melody';
      melodyTrack.channel = 0;

      for (const note of melodyNotes) {
        melodyTrack.addNote({
          midi: note.pitch,
          time: note.time,
          duration: note.duration,
          velocity: note.velocity / 127,
        });
      }
    }

    // Add piano track (if not solo-only mode)
    if (this._options.outputMode !== 'solo-only') {
      const pianoTrack = midi.addTrack();
      pianoTrack.name = 'Piano';
      pianoTrack.channel = 1;
      pianoTrack.instrument.number = 0; // Acoustic Grand Piano

      for (const chord of chords) {
        const voicing = this._getChordVoicing(chord);
        const velocity = 60 * energy.piano;

        for (const pitch of voicing) {
          pianoTrack.addNote({
            midi: pitch,
            time: chord.time,
            duration: chord.duration * 0.9, // Slight staccato
            velocity: velocity / 127,
          });
        }
      }
    }

    // Add bass track (if not solo-only mode)
    if (this._options.outputMode !== 'solo-only') {
      const bassTrack = midi.addTrack();
      bassTrack.name = 'Bass';
      bassTrack.channel = 2;
      bassTrack.instrument.number = 32; // Acoustic Bass

      for (const chord of chords) {
        const bassNote = 36 + chord.root; // Bass octave
        const velocity = 70 * energy.bass;

        bassTrack.addNote({
          midi: bassNote,
          time: chord.time,
          duration: chord.duration * 0.8,
          velocity: velocity / 127,
        });

        // Add fifth for more fullness
        const beatDuration = 60 / tempo;
        if (chord.duration >= beatDuration * 2) {
          bassTrack.addNote({
            midi: bassNote + 7, // Fifth
            time: chord.time + beatDuration,
            duration: beatDuration * 0.8,
            velocity: (velocity * 0.8) / 127,
          });
        }
      }
    }

    // Add string pad track (if not solo-only mode)
    if (this._options.outputMode !== 'solo-only') {
      const stringsTrack = midi.addTrack();
      stringsTrack.name = 'Strings';
      stringsTrack.channel = 3;
      stringsTrack.instrument.number = 48; // String Ensemble 1

      for (const chord of chords) {
        const voicing = this._getChordVoicing(chord);
        const velocity = 50 * energy.strings; // Softer than piano for pad effect

        for (const pitch of voicing) {
          stringsTrack.addNote({
            midi: pitch,
            time: chord.time,
            duration: chord.duration, // Full sustain for pad
            velocity: velocity / 127,
          });
        }
      }
    }

    // Add brass section track (if not solo-only mode)
    if (this._options.outputMode !== 'solo-only') {
      const brassTrack = midi.addTrack();
      brassTrack.name = 'Brass';
      brassTrack.channel = 4;
      brassTrack.instrument.number = 61; // Brass Section

      const beatDuration = 60 / tempo;

      for (const chord of chords) {
        const voicing = this._getChordVoicing(chord);
        const velocity = 75 * energy.brass;

        // Play on strong beats (1 and 3 of a 4-beat measure)
        const beatInMeasure = Math.floor(chord.time / beatDuration) % 4;
        const isStrongBeat = beatInMeasure === 0 || beatInMeasure === 2;

        if (isStrongBeat) {
          for (const pitch of voicing) {
            brassTrack.addNote({
              midi: pitch,
              time: chord.time,
              duration: chord.duration * 0.6, // Punchy, not too long
              velocity: velocity / 127,
            });
          }
        }
      }
    }

    // Add drum track (if not solo-only mode)
    if (this._options.outputMode !== 'solo-only') {
      const drumTrack = midi.addTrack();
      drumTrack.name = 'Drums';
      drumTrack.channel = 9; // Channel 10 (9 in 0-based) for drums

      const beatDuration = 60 / tempo;

      // Calculate total duration from both melody and chords to ensure full coverage
      const melodyEndTime =
        melodyNotes.length > 0
          ? melodyNotes[melodyNotes.length - 1].time +
            melodyNotes[melodyNotes.length - 1].duration
          : 0;
      const chordEndTime =
        chords.length > 0
          ? chords[chords.length - 1].time + chords[chords.length - 1].duration
          : 0;
      const totalDuration = Math.max(melodyEndTime, chordEndTime);

      for (let time = 0; time < totalDuration; time += beatDuration) {
        const beat = Math.floor(time / beatDuration) % 4;
        const velocity = 80 * energy.drums;

        // Kick drum on beats 1 and 3
        if (beat === 0 || beat === 2) {
          drumTrack.addNote({
            midi: 36, // Bass Drum 1
            time,
            duration: beatDuration * 0.3,
            velocity: velocity / 127,
          });
        }

        // Snare on beats 2 and 4
        if (beat === 1 || beat === 3) {
          drumTrack.addNote({
            midi: 38, // Acoustic Snare
            time,
            duration: beatDuration * 0.3,
            velocity: (velocity * 0.9) / 127,
          });
        }

        // Hi-hat on every beat
        drumTrack.addNote({
          midi: 42, // Closed Hi-Hat
          time,
          duration: beatDuration * 0.2,
          velocity: (velocity * 0.6) / 127,
        });
      }
    }

    // Convert to ArrayBuffer
    const midiArray = midi.toArray();
    return midiArray.buffer;
  }

  /**
   * Get piano voicing for a chord
   */
  private _getChordVoicing(chord: Chord): number[] {
    const root = 48 + chord.root; // Piano middle range

    switch (chord.type) {
      case 'major':
        return [root, root + 4, root + 7];
      case 'minor':
        return [root, root + 3, root + 7];
      case 'dominant7':
        return [root, root + 4, root + 7, root + 10];
      case 'diminished':
        return [root, root + 3, root + 6];
      default:
        return [root, root + 4, root + 7];
    }
  }

  get midi(): ArrayBuffer {
    assertIsDefined(this._midi);
    return this._midi;
  }

  get timemap(): MeasureTimemap {
    assertIsDefined(this._timemap);
    // Return the full timemap - don't collapse it
    // The renderer will handle duplicate measure numbers appropriately
    return this._timemap;
  }

  get unrolledMusicXml(): string | undefined {
    return this._unrolledMusicXml;
  }

  get version(): string {
    return `${pkg.name}/AccompanimentConverter v${pkg.version}`;
  }
}
