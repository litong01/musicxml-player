import type { IMIDIConverter, MeasureTimemap } from './interfaces/IMIDIConverter';
import type { PlayerOptions } from './Player';
export interface AccompanimentOptions {
    introMode?: 'auto' | 'always' | 'none';
    introIntensity?: 'soft' | 'medium' | 'strong';
    bandEnergy?: 'soft' | 'medium' | 'strong';
    outputMode?: 'solo-only' | 'band-only' | 'solo-and-band';
    drummerPracticeMode?: boolean;
}
/**
 * Implementation of IMIDIConverter that generates accompaniment tracks (piano, bass, drums)
 * from a MusicXML score.
 */
export declare class AccompanimentConverter implements IMIDIConverter {
    protected _midi?: ArrayBuffer;
    protected _timemap?: MeasureTimemap;
    protected _unrolledMusicXml?: string;
    protected _options: Required<AccompanimentOptions>;
    constructor(options?: AccompanimentOptions);
    initialize(musicXml: string, options: Required<PlayerOptions>): Promise<void>;
    /**
     * Extract tempo metadata from ORIGINAL MusicXML (before unrolling)
     * Returns initial tempo and tempo changes with measure numbers only
     */
    private _extractTempoMetadata;
    /**
     * Extract tempo changes from unrolled and normalized XML.
     * Returns tempo changes with their POSITION in the unrolled sequence.
     */
    private _extractTempoChangesFromUnrolled;
    /**
     * Generate a timemap from normalized unrolled XML.
     * Creates continuous timeline with proper tempo-based durations.
     */
    private _generateTimemapFromXML;
    /**
     * Extract notes from parsed MusicXML (UNROLLED and NORMALIZED version)
     * Each measure already has explicit tempo thanks to normalization
     */
    private _extractNotes;
    /**
     * Detect key signature from MusicXML
     */
    private _detectKey;
    /**
     * Generate chord progression based on melody notes
     */
    private _generateChords;
    /**
     * Find most likely chord root from a set of pitch classes
     */
    private _findMostLikelyRoot;
    /**
     * Infer chord type from pitch classes
     */
    private _inferChordType;
    /**
     * Create MIDI file with accompaniment tracks
     */
    private _createMidiWithAccompaniment;
    /**
     * Get piano voicing for a chord
     */
    private _getChordVoicing;
    get midi(): ArrayBuffer;
    get timemap(): MeasureTimemap;
    get unrolledMusicXml(): string | undefined;
    get version(): string;
}
//# sourceMappingURL=AccompanimentConverter.d.ts.map