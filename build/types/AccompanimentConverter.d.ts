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
    protected _options: Required<AccompanimentOptions>;
    constructor(options?: AccompanimentOptions);
    initialize(musicXml: string, options: Required<PlayerOptions>): Promise<void>;
    /**
     * Extract notes from parsed MusicXML
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
    get version(): string;
}
//# sourceMappingURL=AccompanimentConverter.d.ts.map