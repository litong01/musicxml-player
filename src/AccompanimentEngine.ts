import { Midi } from '@tonejs/midi';
import { XMLParser } from 'fast-xml-parser';

/* -------------------------------------------------------------
 * Public types & API
 * ----------------------------------------------------------- */

export type IntroMode = 'auto' | 'always' | 'none';
export type Intensity = 'soft' | 'medium' | 'strong';
export type OutputMode = 'solo-only' | 'band-only' | 'solo-and-band';

export interface BandOptions {
  introMode?: IntroMode; // how intros behave (not fully used yet, reserved)
  introIntensity?: Intensity; // how strong the intro is
  bandEnergy?: Intensity; // overall band density/energy
  outputMode?: OutputMode; // which tracks to output
  drummerPracticeMode?: boolean; // for percussion scores: invent harmony + band (default: true)
}

/**
 * Main entry point:
 *  - Takes MusicXML as string
 *  - Returns a Midi object with:
 *      - pitched score: Track 0 = melody, others = band
 *      - percussion-only score: Track 0 = original drums, others = invented band
 */
export async function generateBandMidiFromMusicXML(
  xml: string,
  options: BandOptions = {},
): Promise<InstanceType<typeof Midi>> {
  const {
    introMode = 'auto',
    introIntensity = 'medium',
    bandEnergy = 'medium',
    outputMode = 'solo-and-band',
    drummerPracticeMode = true,
  } = options;

  const score = parseMusicXML(xml);
  const expandedMeasures = expandRepeats(score.measures);

  const structure = analyzeStructure(
    expandedMeasures,
    score.time.beats,
    score.divisions,
  );

  const midi = new Midi();
  midi.header.tempos.push({ bpm: score.tempo, ticks: 0 });

  if (score.isPercussionOnly) {
    // Drumset / percussion-only score
    const percussionEvents = extractPercussionEvents(
      expandedMeasures,
      score.divisions,
    );
    const chords = drummerPracticeMode
      ? generateGenericChordProgression(structure.measureCount)
      : [];

    const pianoPart = drummerPracticeMode
      ? generatePianoPart(chords, structure, {
          introMode,
          introIntensity,
          bandEnergy,
        })
      : [];

    const bassPart = drummerPracticeMode
      ? generateBassPart(chords, structure, { introMode, bandEnergy })
      : [];

    const padPart = drummerPracticeMode
      ? generatePadPart(chords, structure, { bandEnergy })
      : [];

    // Output according to mode
    if (outputMode === 'solo-only' || outputMode === 'solo-and-band') {
      addPercussionTrack(midi, percussionEvents);
    }
    if (
      drummerPracticeMode &&
      chords.length > 0 &&
      (outputMode === 'band-only' || outputMode === 'solo-and-band')
    ) {
      addPianoTrack(midi, pianoPart);
      addBassTrack(midi, bassPart);
      addPadTrack(midi, padPart);
    }

    return midi;
  }

  // Pitched score: extract melody, infer harmony, generate band
  const melodyNotes = extractMelody(expandedMeasures, score.divisions);
  const key = detectKey(melodyNotes.map((n) => n.midi));
  
  const chords = inferChordsFromMelody(
    melodyNotes.map((n) => n.midi),
    key,
    structure.measureCount,
  );

  const pianoPart = generatePianoPart(chords, structure, {
    introMode,
    introIntensity,
    bandEnergy,
  });

  const bassPart = generateBassPart(chords, structure, {
    introMode,
    bandEnergy,
  });

  const drumPart = generateDrumKitPart(structure.measureCount, structure, {
    bandEnergy,
  });

  if (outputMode === 'solo-only' || outputMode === 'solo-and-band') {
    addMelodyTrack(midi, melodyNotes);
  }
  if (outputMode === 'band-only' || outputMode === 'solo-and-band') {
    addPianoTrack(midi, pianoPart);
    addBassTrack(midi, bassPart);
    addDrumKitTrack(midi, drumPart);
  }

  return midi;
}

/* -------------------------------------------------------------
 * Internal types
 * ----------------------------------------------------------- */

interface Score {
  measures: Measure[];
  divisions: number;
  time: { beats: number; beatType: number };
  tempo: number;
  isPercussionOnly: boolean;
}

interface Measure {
  index: number;
  notes: XmlNote[];
  repeat?: { direction: 'forward' | 'backward' };
  endingNumber?: number;
}

interface XmlNote {
  isRest: boolean;
  isPercussion: boolean;
  midi?: number; // pre-mapped midi for both pitched & percussion
  durationDivs: number; // raw MusicXML duration
  voice: number;
}

interface MelodyNote {
  midi: number;
  startBeat: number;
  durationBeats: number;
}

interface PercNoteEvent {
  midi: number;
  timeBeats: number;
  durationBeats: number;
  velocity: number;
}

interface StructureInfo {
  measureCount: number;
  beatsPerMeasure: number;
  pickupBeats: number;
  introMeasures: number;
  phraseBoundaries: number[];
}

/* -------------------------------------------------------------
 * 1. MusicXML parsing (single-part, pitched & unpitched)
 * ----------------------------------------------------------- */

function parseMusicXML(xml: string): Score {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
  });

  const json = parser.parse(xml);
  const scorePartwise = json['score-partwise'] || json['score-timewise'];
  const part = Array.isArray(scorePartwise.part)
    ? scorePartwise.part[0]
    : scorePartwise.part;

  const measuresRaw = Array.isArray(part.measure)
    ? part.measure
    : [part.measure];

  let divisions = 1;
  let beats = 4;
  let beatType = 4;
  let tempo = 90;

  const measures: Measure[] = [];
  let anyPitched = false;
  let anyPercussion = false;

  measuresRaw.forEach((m: any, i: number) => {
    if (m.attributes) {
      const attrs = m.attributes;
      if (attrs.divisions) divisions = Number(attrs.divisions);
      if (attrs.time) {
        const time = Array.isArray(attrs.time) ? attrs.time[0] : attrs.time;
        beats = Number(time.beats);
        beatType = Number(time['beat-type']);
      }
    }

    if (m['sound'] && m['sound'].tempo) {
      tempo = Number(m['sound'].tempo);
    }

    const notes: XmlNote[] = [];
    const noteArray = Array.isArray(m.note) ? m.note : m.note ? [m.note] : [];

    for (const n of noteArray) {
      const isRest = !!n.rest;
      let isPercussion = false;
      let midi: number | undefined;

      if (!isRest && n.unpitched) {
        // percussion / unpitched
        isPercussion = true;
        anyPercussion = true;

        const display = n.unpitched;
        const step = display['display-step'] || 'C';
        // rough mapping by step; you can refine this mapping
        midi = mapUnpitchedStepToMidi(step);
      } else if (!isRest && n.pitch) {
        // pitched
        anyPitched = true;
        const step = n.pitch.step;
        const alter = n.pitch.alter ? Number(n.pitch.alter) : 0;
        const octave = Number(n.pitch.octave);
        midi = pitchToMidi(step, alter, octave);
      }

      const durationDivs = n.duration ? Number(n.duration) : divisions;
      const voice = n.voice ? Number(n.voice) : 1;

      const note: XmlNote = {
        isRest,
        isPercussion,
        durationDivs,
        voice,
      };
      if (midi !== undefined) {
        note.midi = midi;
      }
      notes.push(note);
    }

    let repeat: Measure['repeat'] | undefined;
    let endingNumber: number | undefined;

    const barlineArray = Array.isArray(m.barline)
      ? m.barline
      : m.barline
        ? [m.barline]
        : [];
    for (const bl of barlineArray) {
      if (bl.repeat && bl.repeat.direction) {
        const dir = bl.repeat.direction as 'forward' | 'backward';
        repeat = { direction: dir };
      }
      if (bl.ending && bl.ending.number) {
        endingNumber = Number(bl.ending.number);
      }
    }

    const measure: Measure = {
      index: i,
      notes,
    };
    if (repeat !== undefined) {
      measure.repeat = repeat;
    }
    if (endingNumber !== undefined) {
      measure.endingNumber = endingNumber;
    }
    measures.push(measure);
  });

  const isPercussionOnly = anyPercussion && !anyPitched;

  return {
    measures,
    divisions,
    time: { beats, beatType },
    tempo,
    isPercussionOnly,
  };
}

function mapUnpitchedStepToMidi(step: string): number {
  // Very rough, step-based mapping to common GM drum notes
  const s = step.toUpperCase();
  switch (s) {
    case 'C':
      return 36; // kick
    case 'D':
      return 38; // snare
    case 'E':
      return 43; // low floor tom
    case 'F':
      return 47; // mid tom
    case 'G':
      return 50; // high tom
    case 'A':
      return 42; // closed hi-hat
    case 'B':
      return 49; // crash
    default:
      return 38;
  }
}

/* -------------------------------------------------------------
 * 2. Repeat expansion (basic)
 * ----------------------------------------------------------- */

function expandRepeats(measures: Measure[]): Measure[] {
  const expanded: Measure[] = [];
  let repeatStartIndex = 0;

  for (let i = 0; i < measures.length; i++) {
    const m = measures[i];

    if (m.repeat?.direction === 'forward') {
      repeatStartIndex = i;
    }

    expanded.push(m);

    if (m.repeat?.direction === 'backward') {
      const secondPass = measures
        .slice(repeatStartIndex, i + 1)
        .filter((mm) => mm.endingNumber !== 1);
      expanded.push(...secondPass);
    }
  }

  return expanded;
}

/* -------------------------------------------------------------
 * 3. Structure analysis (used for both pitched & drums)
 * ----------------------------------------------------------- */

function analyzeStructure(
  measures: Measure[],
  beatsPerMeasure: number,
  divisions: number,
): StructureInfo {
  const measureCount = measures.length;

  // Detect first non-rest pitched or percussion note in voice 1
  let firstNoteMeasure = 0;
  let firstNoteBeatOffset = 0;

  outer: for (let i = 0; i < measureCount; i++) {
    const m = measures[i];
    let localBeat = 0;

    for (const n of m.notes) {
      const durBeats = n.durationDivs / divisions;
      if (!n.isRest && n.voice === 1 && n.midi !== undefined) {
        firstNoteMeasure = i;
        firstNoteBeatOffset = localBeat;
        break outer;
      }
      localBeat += durBeats;
    }
  }

  const pickupBeats =
    firstNoteMeasure === 0 && firstNoteBeatOffset > 0 ? firstNoteBeatOffset : 0;

  const introMeasures = firstNoteMeasure;

  const phraseBoundaries: number[] = [];
  for (let i = 3; i < measureCount; i += 4) {
    phraseBoundaries.push(i);
  }
  if (!phraseBoundaries.includes(measureCount - 1)) {
    phraseBoundaries.push(measureCount - 1);
  }

  return {
    measureCount,
    beatsPerMeasure,
    pickupBeats,
    introMeasures,
    phraseBoundaries,
  };
}

/* -------------------------------------------------------------
 * 4. Melody extraction (for pitched scores)
 * ----------------------------------------------------------- */

function extractMelody(measures: Measure[], divisions: number): MelodyNote[] {
  const notes: MelodyNote[] = [];
  let currentBeat = 0;

  for (const m of measures) {
    const voice1Notes = m.notes.filter(
      (n) =>
        !n.isRest && !n.isPercussion && n.voice === 1 && n.midi !== undefined,
    );

    if (voice1Notes.length === 0) {
      // assume full bar of time passes
      const approximateBeats = 4; // can be refined using time signature
      currentBeat += approximateBeats;
      continue;
    }

    for (const n of voice1Notes) {
      if (n.midi === undefined) continue;

      const durationBeats = n.durationDivs / divisions;
      notes.push({
        midi: n.midi,
        startBeat: currentBeat,
        durationBeats: Math.max(0.25, durationBeats),
      });
      currentBeat += durationBeats;
    }
  }

  return notes;
}

function pitchToMidi(step: string, alter: number, octave: number): number {
  const baseMap: Record<string, number> = {
    C: 0,
    D: 2,
    E: 4,
    F: 5,
    G: 7,
    A: 9,
    B: 11,
  };
  return 12 * (octave + 1) + baseMap[step] + alter;
}

/* -------------------------------------------------------------
 * 5. Percussion extraction (for drumset scores)
 * ----------------------------------------------------------- */

function extractPercussionEvents(
  measures: Measure[],
  divisions: number,
): PercNoteEvent[] {
  const events: PercNoteEvent[] = [];
  let currentBeat = 0;

  for (const m of measures) {
    for (const n of m.notes) {
      const durBeats = n.durationDivs / divisions;

      if (!n.isRest && n.isPercussion && n.midi !== undefined) {
        events.push({
          midi: n.midi,
          timeBeats: currentBeat,
          durationBeats: Math.max(0.1, durBeats),
          velocity: 0.85,
        });
      }
      currentBeat += durBeats;
    }
  }

  return events;
}

/* -------------------------------------------------------------
 * 6. Key detection (for pitched scores)
 * ----------------------------------------------------------- */

function detectKey(midiNotes: number[]): string {
  if (midiNotes.length === 0) return 'C';

  const pcs = midiNotes.map((n) => n % 12);
  const histogram = new Array(12).fill(0);
  pcs.forEach((pc) => histogram[pc]++);

  const majorProfile = [
    6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88,
  ];
  const keyNames = [
    'C',
    'C#',
    'D',
    'D#',
    'E',
    'F',
    'F#',
    'G',
    'G#',
    'A',
    'A#',
    'B',
  ];

  let bestKeyIndex = 0;
  let bestScore = -Infinity;

  for (let k = 0; k < 12; k++) {
    let score = 0;
    for (let i = 0; i < 12; i++) {
      score += histogram[(i + k) % 12] * majorProfile[i];
    }
    if (score > bestScore) {
      bestScore = score;
      bestKeyIndex = k;
    }
  }

  return keyNames[bestKeyIndex];
}

/* -------------------------------------------------------------
 * 7. Chord inference (for pitched scores)
 * ----------------------------------------------------------- */

function inferChordsFromMelody(
  midiMelody: number[],
  key: string,
  measureCount: number,
): string[] {
  const scaleMap: Record<string, number[]> = {
    'C': [0, 2, 4, 5, 7, 9, 11],
    'G': [7, 9, 11, 0, 2, 4, 6],
    'D': [2, 4, 6, 7, 9, 11, 1],
    'A': [9, 11, 1, 2, 4, 6, 8],
    'E': [4, 6, 8, 9, 11, 1, 3],
    'B': [11, 1, 3, 4, 6, 8, 10],
    'F#': [6, 8, 10, 11, 1, 3, 5],
    'C#': [1, 3, 5, 6, 8, 10, 0],
    'F': [5, 7, 9, 10, 0, 2, 4],
    'Bb': [10, 0, 2, 3, 5, 7, 9],
    'Eb': [3, 5, 7, 8, 10, 0, 2],
    'Ab': [8, 10, 0, 1, 3, 5, 7],
  };

  const scale = scaleMap[key] || scaleMap['C'];
  const chordLabels = ['I', 'ii', 'iii', 'IV', 'V', 'vi'];
  const chords: string[] = [];

  const notesPerMeasure = Math.max(
    1,
    Math.round(midiMelody.length / measureCount),
  );

  for (let m = 0; m < measureCount; m++) {
    const slice = midiMelody
      .slice(m * notesPerMeasure, (m + 1) * notesPerMeasure)
      .map((n) => n % 12);

    if (slice.length === 0) {
      chords.push(m === measureCount - 1 ? 'I' : 'V');
      continue;
    }

    let bestChord = 'I';
    let bestScore = -Infinity;

    chordLabels.forEach((label, idx) => {
      const root = scale[idx];
      const triad = [root, (root + 4) % 12, (root + 7) % 12];
      let score = 0;

      slice.forEach((pc) => {
        if (triad.includes(pc)) score += 2;
        if (pc === root) score += 1;
      });

      if (score > bestScore) {
        bestScore = score;
        bestChord = label;
      }
    });

    chords.push(bestChord);
  }

  return chords;
}

/* -------------------------------------------------------------
 * 8. Generic chord progression generator (for drum-only scores)
 * ----------------------------------------------------------- */

function generateGenericChordProgression(measureCount: number): string[] {
  // Simple pop-ish loop: I - V - vi - IV
  const loop = ['I', 'V', 'vi', 'IV'];
  const chords: string[] = [];

  for (let i = 0; i < measureCount; i++) {
    chords.push(loop[i % loop.length]);
  }

  return chords;
}

/* -------------------------------------------------------------
 * 9. Accompaniment generation (piano, bass, pads, drum kit)
 * ----------------------------------------------------------- */

interface PianoChordEvent {
  beat: number;
  notes: number[];
  isFill?: boolean;
}

interface BassNoteEvent {
  beat: number;
  midi: number;
}

interface DrumEvent {
  beat: number;
  midi: number;
  duration: number;
  velocity: number;
}

interface PadChordEvent {
  beat: number;
  durationBeats: number;
  notes: number[];
}

/* --- 9.1 Piano --- */

function generatePianoPart(
  chords: string[],
  structure: StructureInfo,
  opts: {
    introMode: IntroMode;
    introIntensity: Intensity;
    bandEnergy: Intensity;
  },
): PianoChordEvent[] {
  const chordMap: Record<string, number[]> = {
    I: [0, 4, 7],
    ii: [2, 5, 9],
    iii: [4, 7, 11],
    IV: [5, 9, 0],
    V: [7, 11, 2],
    vi: [9, 0, 4],
  };

  const events: PianoChordEvent[] = [];
  const beatsPerMeasure = structure.beatsPerMeasure;
  const baseOctave = 4;

  const energyFactor = intensityToFactor(opts.bandEnergy);
  const introFactor = intensityToFactor(opts.introIntensity);

  for (let m = 0; m < chords.length; m++) {
    const label = chords[m] || 'I';
    const triad = chordMap[label] || chordMap['I'];
    const measureStartBeat = m * beatsPerMeasure;

    const isIntroMeasure = m < structure.introMeasures;
    const isPhraseEnd = structure.phraseBoundaries.includes(m);

    const factor = isIntroMeasure ? introFactor : energyFactor;

    const rootPos = triad.map((pc) => pc + 12 * baseOctave);

    if (factor <= 0.5) {
      events.push({
        beat: measureStartBeat,
        notes: rootPos,
      });
    } else if (factor <= 0.8) {
      events.push({
        beat: measureStartBeat,
        notes: rootPos,
      });
      events.push({
        beat: measureStartBeat + beatsPerMeasure / 2,
        notes: rootPos,
      });
    } else {
      events.push({
        beat: measureStartBeat,
        notes: rootPos,
      });
      events.push({
        beat: measureStartBeat + 1.5,
        notes: invertTriad(rootPos, 1),
      });
      events.push({
        beat: measureStartBeat + 3,
        notes: rootPos,
      });
    }

    if (isPhraseEnd && factor >= 0.6) {
      events.push({
        beat: measureStartBeat + beatsPerMeasure - 0.5,
        notes: invertTriad(rootPos, 2),
        isFill: true,
      });
    }
  }

  return events;
}

function invertTriad(notes: number[], inversion: 0 | 1 | 2): number[] {
  const sorted = [...notes].sort((a, b) => a - b);
  if (inversion === 0) return sorted;
  if (inversion === 1) return [sorted[1], sorted[2], sorted[0] + 12];
  return [sorted[2], sorted[0] + 12, sorted[1] + 12];
}

/* --- 9.2 Bass --- */

function generateBassPart(
  chords: string[],
  structure: StructureInfo,
  opts: { introMode: IntroMode; bandEnergy: Intensity },
): BassNoteEvent[] {
  const rootMap: Record<string, number> = {
    I: 0,
    ii: 2,
    iii: 4,
    IV: 5,
    V: 7,
    vi: 9,
  };

  const events: BassNoteEvent[] = [];
  const beatsPerMeasure = structure.beatsPerMeasure;
  const baseOctave = 2;
  const factor = intensityToFactor(opts.bandEnergy);

  for (let m = 0; m < chords.length; m++) {
    const label = chords[m] || 'I';
    const rootPc = rootMap[label] ?? 0;
    const measureStartBeat = m * beatsPerMeasure;
    const rootMidi = rootPc + 12 * baseOctave;

    events.push({ beat: measureStartBeat, midi: rootMidi });

    if (factor >= 0.7) {
      const fifthMidi = rootMidi + 7;
      events.push({
        beat: measureStartBeat + beatsPerMeasure / 2,
        midi: fifthMidi,
      });
    }
  }

  return events;
}

/* --- 9.3 Pads (for drum practice ambience) --- */

function generatePadPart(
  chords: string[],
  structure: StructureInfo,
  opts: { bandEnergy: Intensity },
): PadChordEvent[] {
  const chordMap: Record<string, number[]> = {
    I: [0, 4, 7],
    ii: [2, 5, 9],
    iii: [4, 7, 11],
    IV: [5, 9, 0],
    V: [7, 11, 2],
    vi: [9, 0, 4],
  };

  const events: PadChordEvent[] = [];
  const beatsPerMeasure = structure.beatsPerMeasure;
  const baseOctave = 5;
  const factor = intensityToFactor(opts.bandEnergy);

  for (let m = 0; m < chords.length; m++) {
    const label = chords[m] || 'I';
    const triad = chordMap[label] || chordMap['I'];
    const measureStartBeat = m * beatsPerMeasure;

    const sustain = beatsPerMeasure * (factor <= 0.5 ? 1 : 2);
    const notes = triad.map((pc) => pc + 12 * baseOctave);

    events.push({
      beat: measureStartBeat,
      durationBeats: sustain,
      notes,
    });
  }

  return events;
}

/* --- 9.4 Drum kit (for pitched scores, band drum track) --- */

function generateDrumKitPart(
  measureCount: number,
  structure: StructureInfo,
  opts: { bandEnergy: Intensity },
): DrumEvent[] {
  const events: DrumEvent[] = [];
  const beatsPerMeasure = structure.beatsPerMeasure;

  const KICK = 36;
  const SNARE = 38;
  const HAT = 42;
  const TOM1 = 48;
  const TOM2 = 45;
  const CRASH = 49;

  const factor = intensityToFactor(opts.bandEnergy);

  for (let m = 0; m < measureCount; m++) {
    const measureStart = m * beatsPerMeasure;
    const isPhraseEnd = structure.phraseBoundaries.includes(m);

    const hatDensity = factor <= 0.5 ? 4 : 8;

    [0, 2].forEach((offset) => {
      events.push({
        beat: measureStart + offset,
        midi: KICK,
        duration: 0.1,
        velocity: 0.9,
      });
    });

    [1, 3].forEach((offset) => {
      events.push({
        beat: measureStart + offset,
        midi: SNARE,
        duration: 0.1,
        velocity: 0.85,
      });
    });

    const hatStep = beatsPerMeasure / hatDensity;
    for (let i = 0; i < hatDensity; i++) {
      events.push({
        beat: measureStart + i * hatStep,
        midi: HAT,
        duration: 0.05,
        velocity: 0.65,
      });
    }

    if (isPhraseEnd && factor >= 0.6) {
      events.push({
        beat: measureStart + beatsPerMeasure - 1,
        midi: TOM1,
        duration: 0.2,
        velocity: 0.9,
      });
      events.push({
        beat: measureStart + beatsPerMeasure - 0.5,
        midi: TOM2,
        duration: 0.2,
        velocity: 0.9,
      });
      events.push({
        beat: measureStart + beatsPerMeasure,
        midi: CRASH,
        duration: 0.5,
        velocity: 1.0,
      });
    }
  }

  return events;
}

/* -------------------------------------------------------------
 * 10. Humanization
 * ----------------------------------------------------------- */

function intensityToFactor(level: Intensity): number {
  if (level === 'soft') return 0.5;
  if (level === 'medium') return 0.75;
  return 1.0;
}

function humanizeBeat(beat: number): number {
  const jitterBeats = Math.random() * 0.02 - 0.01; // ±0.01 beats
  return beat + jitterBeats;
}

function humanizeVelocity(vel: number): number {
  const jitter = Math.random() * 0.1 - 0.05;
  return Math.max(0.05, Math.min(1, vel + jitter));
}

/* -------------------------------------------------------------
 * 11. MIDI track builders
 * ----------------------------------------------------------- */

function addMelodyTrack(midi: InstanceType<typeof Midi>, melody: MelodyNote[]) {
  const track = midi.addTrack();
  track.name = 'Melody';

  melody.forEach((n) => {
    track.addNote({
      midi: n.midi,
      time: n.startBeat,
      duration: n.durationBeats,
      velocity: 0.85,
    });
  });
}

function addPianoTrack(
  midi: InstanceType<typeof Midi>,
  piano: PianoChordEvent[],
) {
  const track = midi.addTrack();
  track.name = 'Piano';

  piano.forEach((chord) => {
    chord.notes.forEach((n) => {
      track.addNote({
        midi: n,
        time: humanizeBeat(chord.beat),
        duration: chord.isFill ? 0.75 : 1.5,
        velocity: humanizeVelocity(chord.isFill ? 0.9 : 0.7),
      });
    });
  });
}

function addBassTrack(midi: InstanceType<typeof Midi>, bass: BassNoteEvent[]) {
  const track = midi.addTrack();
  track.name = 'Bass';

  bass.forEach((b) => {
    track.addNote({
      midi: b.midi,
      time: humanizeBeat(b.beat),
      duration: 3.5,
      velocity: humanizeVelocity(0.85),
    });
  });
}

function addPadTrack(midi: InstanceType<typeof Midi>, pads: PadChordEvent[]) {
  const track = midi.addTrack();
  track.name = 'Pads';

  pads.forEach((p) => {
    p.notes.forEach((n) => {
      track.addNote({
        midi: n,
        time: humanizeBeat(p.beat),
        duration: p.durationBeats,
        velocity: humanizeVelocity(0.4),
      });
    });
  });
}

function addDrumKitTrack(midi: InstanceType<typeof Midi>, drums: DrumEvent[]) {
  const track = midi.addTrack();
  track.name = 'Drums';
  track.channel = 9;

  drums.forEach((d) => {
    track.addNote({
      midi: d.midi,
      time: humanizeBeat(d.beat),
      duration: d.duration,
      velocity: humanizeVelocity(d.velocity),
    });
  });
}

function addPercussionTrack(
  midi: InstanceType<typeof Midi>,
  perc: PercNoteEvent[],
) {
  const track = midi.addTrack();
  track.name = 'OriginalDrums';
  track.channel = 9;

  perc.forEach((e) => {
    track.addNote({
      midi: e.midi,
      time: e.timeBeats,
      duration: e.durationBeats,
      velocity: e.velocity,
    });
  });
}
