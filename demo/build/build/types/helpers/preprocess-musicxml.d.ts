export interface MusicXmlMetadata {
    tempo: number;
    timeSignature: [number, number];
    tempoChanges: Array<{
        measure: number;
        bpm: number;
    }>;
    timeSignatureChanges: Array<{
        measure: number;
        beats: number;
        beatType: number;
    }>;
}
export interface PreprocessResult {
    musicXml: string;
    metadata: MusicXmlMetadata;
}
/**
 * Preprocess MusicXML to fix common issues:
 * 1. Remove fermatas (cause timing issues)
 * 2. Add missing tempo (default to 120 BPM if none exists)
 * 3. Extract all tempo changes
 * 4. Extract all time signature changes
 */
export declare function preprocessMusicXml(musicXml: string): PreprocessResult;
//# sourceMappingURL=preprocess-musicxml.d.ts.map