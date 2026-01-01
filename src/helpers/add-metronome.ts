import { Midi } from '@tonejs/midi';

/**
 * Adds a metronome track to an existing MIDI file
 * @param midiBuffer - The original MIDI file as ArrayBuffer
 * @param tempo - The tempo in BPM (beats per minute)
 * @param duration - Total duration in seconds
 * @returns Modified MIDI file as ArrayBuffer with metronome track added
 */
export function addMetronomeTrack(
  midiBuffer: ArrayBuffer,
  tempo: number = 120,
  duration: number,
): ArrayBuffer {
  // Parse the existing MIDI
  const midiArray = new Uint8Array(midiBuffer);
  const midi = new Midi(midiArray);

  // Get time signature from the first track (default to 4/4 if not found)
  let beatsPerMeasure = 4;
  let beatUnit = 4; // The note value that represents one beat (4 = quarter note, 8 = eighth note)

  // Check all tracks for time signature information
  for (const track of midi.tracks) {
    if (track.timeSignatures && track.timeSignatures.length > 0) {
      const timeSig = track.timeSignatures[0];
      beatsPerMeasure = timeSig.timeSignature[0];
      beatUnit = timeSig.timeSignature[1];
      break;
    }
  }

  // Calculate beat duration based on time signature
  // For example: 4/4 means quarter note gets the beat, 12/8 means eighth note gets the beat
  // beatDuration = (60 / tempo) * (4 / beatUnit)
  // For 4/4: (60/120) * (4/4) = 0.5 seconds per quarter note
  // For 12/8: (60/120) * (4/8) = 0.25 seconds per eighth note
  const beatDuration = (60 / tempo) * (4 / beatUnit);

  // Add metronome track
  const metronomeTrack = midi.addTrack();
  metronomeTrack.name = 'Metronome';
  metronomeTrack.channel = 9; // Drum channel (channel 10, 9 in 0-indexed)

  // Generate metronome clicks
  for (let time = 0; time < duration; time += beatDuration) {
    const beat = Math.floor(time / beatDuration) % beatsPerMeasure;
    const isDownbeat = beat === 0;

    // Use different sounds for downbeat (first beat of measure) vs other beats
    // MIDI note 76 = High Wood Block (downbeat)
    // MIDI note 77 = Low Wood Block (other beats)
    const midiNote = isDownbeat ? 76 : 77;
    const velocity = isDownbeat ? 127 : 110; // Maximum loudness for downbeat, very loud for other beats

    metronomeTrack.addNote({
      midi: midiNote,
      time,
      duration: 0.1, // Short click
      velocity: velocity / 127, // Normalize to 0-1
    });
  }

  // Convert back to ArrayBuffer
  const resultArray = midi.toArray();
  return resultArray.buffer;
}
