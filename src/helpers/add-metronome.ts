import { Midi } from '@tonejs/midi';
import type { MeasureTimemap } from '../interfaces/IMIDIConverter';

/**
 * Adds a metronome track to an existing MIDI file
 * @param midiBuffer - The original MIDI file as ArrayBuffer
 * @param tempo - The initial tempo in BPM (beats per minute)
 * @param duration - Total duration in seconds
 * @param timemap - Optional timemap for measure-based time signature handling
 * @returns Modified MIDI file as ArrayBuffer with metronome track added
 */
export function addMetronomeTrack(
  midiBuffer: ArrayBuffer,
  tempo: number = 120,
  duration: number,
  timemap?: MeasureTimemap,
): ArrayBuffer {
  // Parse the existing MIDI
  const midiArray = new Uint8Array(midiBuffer);
  const midi = new Midi(midiArray);

  // Add metronome track
  const metronomeTrack = midi.addTrack();
  metronomeTrack.name = 'Metronome';
  metronomeTrack.channel = 9; // Drum channel - uses wood block sounds (notes 76-77)

  // If we have a timemap, use it for precise measure-based metronome
  if (timemap && timemap.length > 0) {
    for (let i = 0; i < timemap.length; i++) {
      const entry = timemap[i];
      const measureStart = entry.timestamp / 1000; // Convert ms to seconds
      const measureDuration = entry.duration / 1000; // Actual measure duration

      // Stop if we've exceeded the duration
      if (measureStart >= duration) {
        break;
      }

      // Skip invalid durations
      if (measureDuration <= 0) continue;

      // Get time signature from timemap entry, or default to 4/4
      const timeSignature = entry.timeSignature || [4, 4];
      const beatsPerMeasure = timeSignature[0];

      // Simple and reliable: divide measure duration by beats to get beat duration
      const beatDuration = measureDuration / beatsPerMeasure;

      // For pickup measures, calculate how many actual beats we have
      let actualBeats = beatsPerMeasure;
      let isCompleteMeasure = true;

      // Check if this might be a pickup (incomplete) measure
      if (i + 1 < timemap.length) {
        const nextEntry = timemap[i + 1];
        const nextTimeSignature = nextEntry.timeSignature || [4, 4];

        // If same time signature, compare durations
        if (
          nextTimeSignature[0] === beatsPerMeasure &&
          nextEntry.duration > 0
        ) {
          const nextMeasureDuration = nextEntry.duration / 1000;
          const ratio = measureDuration / nextMeasureDuration;

          // If this measure is significantly shorter, it's likely a pickup
          if (ratio < 0.95) {
            actualBeats = Math.max(1, Math.round(ratio * beatsPerMeasure));
            isCompleteMeasure = false;
          }
        }
      }

      // Generate clicks for this measure
      for (let beat = 0; beat < actualBeats; beat++) {
        const clickTime = measureStart + beat * beatDuration;

        // Skip if after duration
        if (clickTime >= duration) {
          continue;
        }

        // Downbeat only on beat 0 of complete measures
        const isDownbeat = beat === 0 && isCompleteMeasure;

        // Use different sounds for downbeat (first beat of measure) vs other beats
        const midiNote = isDownbeat ? 76 : 77; // High/Low Wood Block
        const velocity = isDownbeat ? 127 : 120;

        metronomeTrack.addNote({
          midi: midiNote,
          time: clickTime,
          duration: 0.1, // Short click
          velocity: velocity / 127,
        });
      }
    }
  } else {
    // Fallback: Use constant 4/4 time signature throughout

    const beatsPerMeasure = 4;
    const beatUnit = 4;
    const beatDuration = (60 / tempo) * (4 / beatUnit);

    for (let time = 0; time < duration; time += beatDuration) {
      const beat = Math.floor(time / beatDuration) % beatsPerMeasure;
      const isDownbeat = beat === 0;

      // Use different sounds for downbeat (first beat of measure) vs other beats
      // MIDI note 76 = High Wood Block (downbeat)
      // MIDI note 77 = Low Wood Block (other beats)
      const midiNote = isDownbeat ? 76 : 77;
      const velocity = isDownbeat ? 127 : 120; // Maximum loudness for downbeat, very loud for other beats

      metronomeTrack.addNote({
        midi: midiNote,
        time,
        duration: 0.1, // Short click
        velocity: velocity / 127, // Normalize to 0-1
      });
    }
  }

  // Convert back to ArrayBuffer
  const resultArray = midi.toArray();
  return resultArray.buffer;
}
