import { Midi } from '@tonejs/midi';
export type IntroMode = 'auto' | 'always' | 'none';
export type Intensity = 'soft' | 'medium' | 'strong';
export type OutputMode = 'solo-only' | 'band-only' | 'solo-and-band';
export interface BandOptions {
    introMode?: IntroMode;
    introIntensity?: Intensity;
    bandEnergy?: Intensity;
    outputMode?: OutputMode;
    drummerPracticeMode?: boolean;
}
/**
 * Main entry point:
 *  - Takes MusicXML as string
 *  - Returns a Midi object with:
 *      - pitched score: Track 0 = melody, others = band
 *      - percussion-only score: Track 0 = original drums, others = invented band
 */
export declare function generateBandMidiFromMusicXML(xml: string, options?: BandOptions): Promise<InstanceType<typeof Midi>>;
//# sourceMappingURL=AccompanimentEngine.d.ts.map