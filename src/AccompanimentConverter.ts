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
  // Individual track selection (more flexible than presets)
  solo?: boolean; // Melody track
  piano?: boolean;
  bass?: boolean;
  strings?: boolean;
  drums?: boolean;
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
      // Default: all tracks enabled (equivalent to old 'solo-and-band')
      solo: options.solo ?? true,
      piano: options.piano ?? true,
      bass: options.bass ?? true,
      strings: options.strings ?? true,
      drums: options.drums ?? true,
      drummerPracticeMode: options.drummerPracticeMode ?? false,
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

    this._timemap = this._generateTimemapFromXML(normalizedXmlDoc);

    // Extract tempo from ORIGINAL MusicXML (for reference only)
    const originalXmlDoc = parser.parse(musicXml);
    const { tempo: initialTempo } = this._extractTempoMetadata(originalXmlDoc);

    // Parse the NORMALIZED UNROLLED MusicXML for note extraction
    const unrolledXmlDoc = parser.parse(normalizedUnrolled);

    // This has the correct tempo flow considering repeats
    const unrolledTempoChanges =
      this._extractTempoChangesFromUnrolled(unrolledXmlDoc);

    // Each measure has explicit tempo from normalization
    const { notes, isPercussion } = this._extractNotes(
      unrolledXmlDoc,
      initialTempo,
    );

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
        tempoChanges.push({
          time: timemapEntry.timestamp / 1000, // Convert ms to seconds
          bpm: change.bpm,
          measure: timemapEntry.measure,
          position: timemapIndex,
        });
      }
    }

    // Sort tempo changes by time to ensure they're in chronological order
    tempoChanges.sort((a, b) => a.time - b.time);

    // Detect key signature
    const keySignature = this._detectKey(unrolledXmlDoc, notes);

    // Generate chord progression
    const chords = this._generateChords(
      notes,
      keySignature,
      isPercussion,
      tempo,
      this._timemap,
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

    if (this._timemap.length > 0) {
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
                } else if (newTempo !== currentTempo) {
                  // Tempo change detected
                  tempoChanges.push({
                    bpm: newTempo,
                    measure: measureNumber,
                  });
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

      // Detect if measures use 0-based (pickup) or 1-based numbering
      const firstMeasureNumber = measures[0]?.['@_number']
        ? Number(measures[0]['@_number'])
        : 0;
      const measureOffset = firstMeasureNumber === 0 ? 0 : -1;

      // FIRST PASS: Build maps of time signatures and tempos by measure number
      // Priority: explicit changes > first occurrence's inherited value
      const originalTimeSignatures = new Map<
        number,
        { beats: number; beatType: number; explicit: boolean }
      >();
      const originalTempos = new Map<
        number,
        { tempo: number; explicit: boolean }
      >();
      let currentMappedTimeBeats = 4;
      let currentMappedBeatType = 4;
      let currentMappedTempo = 120;

      for (let i = 0; i < measures.length; i++) {
        const measure = measures[i];
        if (!measure) continue;

        const measureNumber = measure['@_number']
          ? Number(measure['@_number']) - 1
          : i;

        // Check if this measure has an explicit time signature
        const hasExplicitTimeSig = measure.attributes?.time !== undefined;
        if (hasExplicitTimeSig) {
          currentMappedTimeBeats = Number(measure.attributes.time.beats);
          currentMappedBeatType = Number(measure.attributes.time['beat-type']);
        }

        // Check if this measure has an explicit tempo change
        let hasExplicitTempo = false;
        if (measure.direction) {
          const directions = Array.isArray(measure.direction)
            ? measure.direction
            : [measure.direction];

          for (const direction of directions) {
            if (direction.sound && direction.sound['@_tempo']) {
              currentMappedTempo = Number(direction.sound['@_tempo']);
              hasExplicitTempo = true;
              break;
            }
          }
        }

        const existingTimeSig = originalTimeSignatures.get(measureNumber);
        const existingTempo = originalTempos.get(measureNumber);

        // Store/update time signature: always if not seen, or if explicit and wasn't before
        if (
          !existingTimeSig ||
          (hasExplicitTimeSig && !existingTimeSig.explicit)
        ) {
          originalTimeSignatures.set(measureNumber, {
            beats: currentMappedTimeBeats,
            beatType: currentMappedBeatType,
            explicit: hasExplicitTimeSig,
          });
        }

        // Store/update tempo: always if not seen, or if explicit and wasn't before
        if (!existingTempo || (hasExplicitTempo && !existingTempo.explicit)) {
          originalTempos.set(measureNumber, {
            tempo: currentMappedTempo,
            explicit: hasExplicitTempo,
          });
        }
      }

      // SECOND PASS: Generate timemap using original time signatures and tempos
      const tempoChangeLog: Array<{ measure: number; tempo: number }> = [];

      for (let i = 0; i < measures.length; i++) {
        const measure = measures[i];
        if (!measure) continue;

        // Get measure number (0-based for timemap)
        const measureNumber = measure['@_number']
          ? Number(measure['@_number']) + measureOffset
          : i;

        // Look up the original tempo for this measure number
        const tempoEntry = originalTempos.get(measureNumber) || {
          tempo: 120,
          explicit: false,
        };
        const currentTempo = tempoEntry.tempo;

        if (tempoEntry.explicit) {
          tempoChangeLog.push({ measure: measureNumber, tempo: currentTempo });
        }

        // Look up the original time signature for this measure number
        const timeSig = originalTimeSignatures.get(measureNumber) || {
          beats: 4,
          beatType: 4,
          explicit: false,
        };
        const currentTimeBeats = timeSig.beats;
        const currentBeatType = timeSig.beatType;

        // Calculate measure duration
        let quarterNotes = (currentTimeBeats / currentBeatType) * 4;
        const msPerQuarterNote = 60000 / currentTempo;

        // Special handling for measure 0 (pickup/anacrusis)
        // Check if it's incomplete by summing actual note durations
        if (measureNumber === 0 || measure['@_implicit'] === 'yes') {
          let actualQuarters = 0;
          let divisions = 1;

          if (measure.attributes?.divisions) {
            divisions = Number(measure.attributes.divisions);
          }

          if (measure.note) {
            const measureNotes = Array.isArray(measure.note)
              ? measure.note
              : [measure.note];

            for (const note of measureNotes) {
              if (!note || note.chord) continue;
              if (note.duration) {
                actualQuarters += Number(note.duration) / divisions;
              }
            }
          }

          // If measure is shorter than expected (typical for pickup), use actual duration
          if (actualQuarters > 0 && actualQuarters < quarterNotes - 0.01) {
            quarterNotes = actualQuarters;
          }
        }

        const measureDuration = Math.round(quarterNotes * msPerQuarterNote);

        timemap.push({
          measure: measureNumber,
          timestamp: currentTime,
          duration: measureDuration,
          timeSignature: [currentTimeBeats, currentBeatType], // Include time signature
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

        // Detect if measures use 0-based (pickup) or 1-based numbering
        const firstMeasureNumber = partMeasures[0]?.['@_number']
          ? Number(partMeasures[0]['@_number'])
          : 0;
        const measureOffset = firstMeasureNumber === 0 ? 0 : -1;

        // FIRST PASS: Build a map of time signatures by measure number
        // Priority: explicit time signature changes > first occurrence's inherited value
        const originalMeasureQuarters = new Map<
          number,
          { quarters: number; explicit: boolean }
        >();
        let currentMappedQuarters = 4;

        for (let i = 0; i < partMeasures.length; i++) {
          const measure = partMeasures[i];
          if (!measure) continue;

          const measureNumber = measure['@_number']
            ? Number(measure['@_number']) + measureOffset
            : i;

          // Check if this measure has an explicit time signature
          const hasExplicitTimeSig = measure.attributes?.time !== undefined;
          if (hasExplicitTimeSig) {
            const timeBeats = Number(measure.attributes.time.beats);
            const beatType = Number(measure.attributes.time['beat-type']);
            currentMappedQuarters = (timeBeats / beatType) * 4;
          }

          const existing = originalMeasureQuarters.get(measureNumber);

          // Store/update: always if not seen, or if we have explicit and didn't before
          if (!existing || (hasExplicitTimeSig && !existing.explicit)) {
            originalMeasureQuarters.set(measureNumber, {
              quarters: currentMappedQuarters,
              explicit: hasExplicitTimeSig,
            });
          }
        }

        // SECOND PASS: Extract notes using original time signatures
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

          // Get measure number
          const measureNumber = measure['@_number']
            ? Number(measure['@_number']) + measureOffset
            : i;

          // Get divisions from attributes
          if (measure.attributes?.divisions) {
            divisions = Number(measure.attributes.divisions);
          }

          // Look up the original measure duration for this measure number
          const measureQuartersEntry = originalMeasureQuarters.get(
            measureNumber,
          ) || { quarters: 4, explicit: false };
          let currentMeasureQuarters = measureQuartersEntry.quarters;

          // For pickup measures, use actual duration from timemap instead of time signature
          // The timemap already has the correct shortened duration for pickups
          if (measureNumber === 0 || measure['@_implicit'] === 'yes') {
            const timeSigQuarters = measureQuartersEntry.quarters;
            const timeSigDurationMs = timemapEntry.duration;

            // Back-calculate actual quarter notes from timemap duration
            // We can derive this from the ratio of durations, or use tempo if available
            // For now, use a simple ratio: actualQuarters = timeSigQuarters * (actualDuration / expectedDuration)
            // At 120 BPM, one quarter note = 500ms
            const fullMeasureDuration = (timeSigQuarters * 60000) / 120;
            const actualQuarters =
              (timeSigDurationMs / fullMeasureDuration) * timeSigQuarters;

            if (actualQuarters > 0 && actualQuarters < timeSigQuarters - 0.01) {
              currentMeasureQuarters = actualQuarters;
            }
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

              // Skip rests FIRST before any pitch processing
              if (note.rest !== undefined) {
                positionInMeasure += duration;
                continue;
              }

              // Calculate note time based on timemap timing
              // Map the note's position within the measure to actual time
              const noteTime =
                measureStartTime +
                (positionInMeasure / currentMeasureQuarters) * measureDuration;
              const noteDurationInSeconds =
                (duration / currentMeasureQuarters) * measureDuration;

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
    timemap: MeasureTimemap,
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
      // Use timemap for measure-based chord generation
      if (timemap && timemap.length > 0) {
        timemap.forEach((measure, index) => {
          const chordIndex = index % 4;
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

          chords.push({
            root,
            type,
            time: measure.timestamp / 1000,
            duration: measure.duration / 1000,
          });
        });
      } else {
        // Fallback to fixed duration if no timemap
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
      }

      return chords;
    }

    // For melodic content, analyze notes to infer chords
    // Use timemap for measure-based chord generation if available
    if (timemap && timemap.length > 0) {
      // Generate chords per measure
      timemap.forEach((measure) => {
        const measureStart = measure.timestamp / 1000;
        const measureDuration = measure.duration / 1000;

        // Find notes in this measure
        const measureNotes = notes.filter(
          (n) =>
            n.time >= measureStart && n.time < measureStart + measureDuration,
        );

        if (measureNotes.length === 0) {
          // Use the previous chord or default to I
          if (chords.length > 0) {
            const prev = chords[chords.length - 1];
            chords.push({
              ...prev,
              time: measureStart,
              duration: measureDuration,
            });
          } else {
            chords.push({
              root: keyRoot,
              type: 'major',
              time: measureStart,
              duration: measureDuration,
            });
          }
          return;
        }

        // Analyze note pitches to determine chord
        const pitchClasses = measureNotes.map((n) => n.pitch % 12);
        const uniquePitches = Array.from(new Set(pitchClasses));

        // Simple chord inference: use most common note as root
        const root = this._findMostLikelyRoot(uniquePitches, keyRoot);
        const type = this._inferChordType(uniquePitches, root);

        chords.push({
          root,
          type,
          time: measureStart,
          duration: measureDuration,
        });
      });

      return chords;
    }

    // Fallback: use fixed duration if no timemap
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
   * Get the 7th interval for a chord type
   */
  private _get7thInterval(type: Chord['type']): number | null {
    switch (type) {
      case 'major':
        return 11; // Major 7th
      case 'minor':
        return 10; // Minor 7th
      case 'dominant7':
        return 10; // Minor 7th
      case 'diminished':
        return 9; // Diminished 7th
      default:
        return 11; // Default to major 7th
    }
  }

  /**
   * Choose chord voicing that minimizes movement from previous voicing
   */
  private _getSmootherVoicing(
    currentVoicing: number[],
    previousVoicing: number[],
  ): number[] {
    if (previousVoicing.length === 0) return currentVoicing;

    // Try different inversions and pick the one with minimal total movement
    const inversions: number[][] = [currentVoicing];

    // Generate inversions by moving lowest note up an octave
    for (let i = 1; i < currentVoicing.length; i++) {
      const inverted = [...currentVoicing];
      for (let j = 0; j < i; j++) {
        inverted[j] = inverted[j] + 12; // Move up an octave
      }
      inverted.sort((a, b) => a - b); // Re-sort
      inversions.push(inverted);
    }

    // Find inversion with minimal movement
    let bestInversion = currentVoicing;
    let minMovement = Infinity;

    for (const inversion of inversions) {
      let totalMovement = 0;
      for (
        let i = 0;
        i < Math.min(inversion.length, previousVoicing.length);
        i++
      ) {
        totalMovement += Math.abs(inversion[i] - previousVoicing[i]);
      }
      if (totalMovement < minMovement) {
        minMovement = totalMovement;
        bestInversion = inversion;
      }
    }

    return bestInversion;
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

    // Add original melody track (if solo enabled)
    if (this._options.solo && !isPercussion) {
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

    // Add piano track (if piano enabled)
    if (this._options.piano) {
      const pianoTrack = midi.addTrack();
      pianoTrack.name = 'Piano';
      pianoTrack.channel = 1;
      pianoTrack.instrument.number = 0; // Acoustic Grand Piano

      let previousVoicing: number[] = [];

      for (let i = 0; i < chords.length; i++) {
        const chord = chords[i];
        let voicing = this._getChordVoicing(chord);

        // Add 7th for richer harmony (concert piano sound)
        const seventh = this._get7thInterval(chord.type);
        if (seventh !== null) {
          const seventhPitch = chord.root + seventh + 12 * 4; // Add in upper register
          voicing.push(seventhPitch);
        }

        // Use voice leading: choose inversion that minimizes movement
        if (previousVoicing.length > 0) {
          voicing = this._getSmootherVoicing(voicing, previousVoicing);
        }
        previousVoicing = voicing;

        const baseVelocity = 80 * energy.piano;

        // Skip the bass note (leave for bass track), use mid-to-upper range
        const midVoicing = voicing.slice(1);

        // Pattern: Broken chord arpeggio
        midVoicing.forEach((pitch, index) => {
          // Humanize velocity (slight random variation)
          const velocityVariation = 0.9 + Math.random() * 0.2; // 90%-110%
          const noteVelocity = (baseVelocity * velocityVariation) / 127;

          // Arpeggio timing - stagger each note slightly
          const arpeggioDelay = index * 0.02; // 20ms stagger
          const noteTime = chord.time + arpeggioDelay;

          // First arpeggio sweep
          pianoTrack.addNote({
            midi: pitch,
            time: noteTime,
            duration: chord.duration * 0.5, // Overlap for pedal effect
            velocity: noteVelocity,
          });

          // Second sweep (if measure is long enough)
          if (chord.duration > 1.0) {
            const secondSweepTime =
              chord.time + chord.duration * 0.5 + arpeggioDelay;
            pianoTrack.addNote({
              midi: pitch,
              time: secondSweepTime,
              duration: chord.duration * 0.45,
              velocity: noteVelocity * 0.85, // Slightly softer
            });
          }
        });

        // Add occasional bass octave doubling for fuller sound
        if (i % 2 === 0 && voicing.length > 0) {
          const bassNote = voicing[0];
          const bassOctave = bassNote - 12; // One octave lower
          pianoTrack.addNote({
            midi: bassOctave,
            time: chord.time,
            duration: chord.duration * 0.4,
            velocity: (baseVelocity * 1.1) / 127, // Slightly stronger
          });
        }
      }
    }

    // Add bass track (if bass enabled)
    if (this._options.bass) {
      const bassTrack = midi.addTrack();
      bassTrack.name = 'Bass';
      bassTrack.channel = 2;
      bassTrack.instrument.number = 32; // Acoustic Bass

      for (const chord of chords) {
        const bassNote = 36 + (chord.root % 12); // Bass octave (E1-D#2 range)
        const baseVelocity = 90 * energy.bass;

        // Walking bass pattern for more interesting movement
        // Root on beat 1
        bassTrack.addNote({
          midi: bassNote,
          time: chord.time,
          duration: chord.duration * 0.45,
          velocity: baseVelocity / 127,
        });

        // Add walking notes if measure is long enough
        if (chord.duration > 0.8) {
          // Fifth on beat 2 or 3 (depending on measure length)
          const fifthTime = chord.time + chord.duration * 0.5;
          const fifthNote = bassNote + 7; // Perfect fifth

          bassTrack.addNote({
            midi: fifthNote,
            time: fifthTime,
            duration: chord.duration * 0.35,
            velocity: (baseVelocity * 0.85) / 127,
          });

          // Octave or approach note before next chord
          if (chord.duration > 1.2) {
            const approachTime = chord.time + chord.duration * 0.75;
            const approachNote = bassNote + 12; // Octave up

            bassTrack.addNote({
              midi: approachNote,
              time: approachTime,
              duration: chord.duration * 0.2,
              velocity: (baseVelocity * 0.75) / 127,
            });
          }
        }
      }
    }

    // Add string pad track (if strings enabled)
    if (this._options.strings) {
      const stringsTrack = midi.addTrack();
      stringsTrack.name = 'Strings';
      stringsTrack.channel = 3;
      stringsTrack.instrument.number = 48; // String Ensemble 1

      let previousStringVoicing: number[] = [];

      for (const chord of chords) {
        let voicing = this._getChordVoicing(chord);

        // Use voice leading for smooth string transitions
        if (previousStringVoicing.length > 0) {
          voicing = this._getSmootherVoicing(voicing, previousStringVoicing);
        }
        previousStringVoicing = voicing;

        const baseVelocity = 65 * energy.strings; // Softer than piano for pad effect

        // Strings play full chords with sustain and slight swell
        for (let i = 0; i < voicing.length; i++) {
          const pitch = voicing[i];

          // Slight velocity variation per note for realism
          const noteVelocity =
            (baseVelocity * (0.95 + Math.random() * 0.1)) / 127;

          // Full sustain for pad effect with slight overlap
          stringsTrack.addNote({
            midi: pitch,
            time: chord.time,
            duration: chord.duration * 1.05, // Slight overlap for smooth transitions
            velocity: noteVelocity,
          });
        }
      }
    }

    // Add brass section track (if not solo-only mode)
    // DISABLED: Focus on metronome fixes first
    // if (this._options.outputMode !== 'solo-only') {
    //   const brassTrack = midi.addTrack();
    //   brassTrack.name = 'Brass';
    //   brassTrack.channel = 4;
    //   brassTrack.instrument.number = 61; // Brass Section

    //   const beatDuration = 60 / tempo;

    //   for (const chord of chords) {
    //     const voicing = this._getChordVoicing(chord);
    //     const velocity = 75 * energy.brass;

    //     // Play on strong beats (1 and 3 of a 4-beat measure)
    //     const beatInMeasure = Math.floor(chord.time / beatDuration) % 4;
    //     const isStrongBeat = beatInMeasure === 0 || beatInMeasure === 2;

    //     if (isStrongBeat) {
    //       for (const pitch of voicing) {
    //         brassTrack.addNote({
    //           midi: pitch,
    //           time: chord.time,
    //           duration: chord.duration * 0.6, // Punchy, not too long
    //           velocity: velocity / 127,
    //         });
    //       }
    //     }
    //   }
    // }

    // Add drum track (if drums enabled)
    if (this._options.drums) {
      const drumTrack = midi.addTrack();
      drumTrack.name = 'Drums';
      drumTrack.channel = 9; // Channel 10 (9 in 0-based) for drums

      // Use measure-based drumming that respects timemap
      for (const chord of chords) {
        const measureStart = chord.time;
        const measureDuration = chord.duration;
        const beatsInMeasure = Math.max(2, Math.round(measureDuration / 0.5)); // Estimate beats
        const beatDuration = measureDuration / beatsInMeasure;

        const baseVelocity = 100 * energy.drums;

        // Play drum pattern within each measure
        for (let beat = 0; beat < beatsInMeasure; beat++) {
          const beatTime = measureStart + beat * beatDuration;
          const isDownbeat = beat === 0;
          const isBackbeat = beat % 2 === 1; // Beats 2, 4, etc.

          // Kick drum on downbeat and beat 3 (if 4/4)
          if (isDownbeat || (beat === 2 && beatsInMeasure >= 4)) {
            drumTrack.addNote({
              midi: 36, // Bass Drum 1
              time: beatTime,
              duration: beatDuration * 0.3,
              velocity: (baseVelocity * (isDownbeat ? 1.0 : 0.85)) / 127,
            });
          }

          // Snare on backbeats (2 and 4)
          if (isBackbeat) {
            drumTrack.addNote({
              midi: 38, // Acoustic Snare
              time: beatTime,
              duration: beatDuration * 0.3,
              velocity: (baseVelocity * 0.9) / 127,
            });
          }

          // Hi-hat on every beat
          drumTrack.addNote({
            midi: 42, // Closed Hi-Hat
            time: beatTime,
            duration: beatDuration * 0.25,
            velocity: (baseVelocity * 0.6) / 127,
          });

          // Add hi-hat eighth notes for more groove
          if (beatDuration > 0.3) {
            drumTrack.addNote({
              midi: 42, // Closed Hi-Hat
              time: beatTime + beatDuration * 0.5,
              duration: beatDuration * 0.2,
              velocity: (baseVelocity * 0.45) / 127,
            });
          }
        }
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
