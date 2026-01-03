import type { MeasureTimemap } from '../interfaces/IMIDIConverter';
/**
 * Adds a metronome track to an existing MIDI file
 * @param midiBuffer - The original MIDI file as ArrayBuffer
 * @param tempo - The initial tempo in BPM (beats per minute)
 * @param duration - Total duration in seconds
 * @param timemap - Optional timemap for measure-based time signature handling
 * @returns Modified MIDI file as ArrayBuffer with metronome track added
 */
export declare function addMetronomeTrack(midiBuffer: ArrayBuffer, tempo: number | undefined, duration: number, timemap?: MeasureTimemap): ArrayBuffer;
//# sourceMappingURL=add-metronome.d.ts.map