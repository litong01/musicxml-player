/**
 * Normalize MusicXML by ensuring each measure has explicit tempo and time signature.
 * Tempo is assigned based on ORIGINAL measure numbers (from @_number attribute),
 * not sequential position, to handle repeats correctly.
 */
export declare function normalizeMeasures(musicXml: string, originalMusicXml: string): string;
//# sourceMappingURL=normalize-measures.d.ts.map