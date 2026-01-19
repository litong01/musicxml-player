import type { IXSLTProcessor } from '../interfaces/IXSLTProcessor';
import { normalizeMeasures } from './normalize-measures';

/**
 * Unroll the MusicXML score by expanding all repeats and jumps into a linear score.
 * Also normalizes each measure to have explicit tempo and time signature.
 */
export async function unrollMusicXml(
  musicXml: string,
  unrollXslUri: string,
  xsltProcessor: IXSLTProcessor,
): Promise<string> {
  try {
    const unrolled = await xsltProcessor.transform(unrollXslUri, musicXml, {
      renumberMeasures: false, // Preserve original measure numbers for tempo mapping
    });

    // Normalize: propagate tempo based on original measure numbers
    return normalizeMeasures(unrolled, musicXml);
  } catch {
    // Return original on error
  }
  return musicXml;
}
