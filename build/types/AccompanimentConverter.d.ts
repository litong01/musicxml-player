import type { IMIDIConverter, MeasureTimemap } from './interfaces/IMIDIConverter';
import { PlayerOptions } from './Player';
import { type BandOptions } from './AccompanimentEngine';
/**
 * Implementation of IMIDIConverter that generates MIDI with accompaniment using the AccompanimentEngine.
 * This converter creates a band accompaniment (piano, bass, drums, pads) around the melody or drum parts.
 *
 * Features:
 * - Automatic key detection and chord inference for pitched scores
 * - Generic chord progression for percussion-only scores
 * - Configurable band energy, intro behavior, and output modes
 * - Handles repeats and jumps through MusicXML unrolling
 */
export declare class AccompanimentConverter implements IMIDIConverter {
    protected _timemap?: MeasureTimemap;
    protected _midi?: ArrayBuffer;
    protected _bandOptions: BandOptions;
    constructor(bandOptions?: BandOptions);
    initialize(musicXml: string, options: Required<PlayerOptions>): Promise<void>;
    get midi(): ArrayBuffer;
    get timemap(): MeasureTimemap;
    get version(): string;
}
//# sourceMappingURL=AccompanimentConverter.d.ts.map