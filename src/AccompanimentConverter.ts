import pkg from '../package.json';
import type {
  IMIDIConverter,
  MeasureTimemap,
} from './interfaces/IMIDIConverter';
import { PlayerOptions } from './Player';
import {
  assertIsDefined,
  parseMusicXmlTimemap,
  unrollMusicXml,
} from './helpers';
import {
  generateBandMidiFromMusicXML,
  type BandOptions,
} from './AccompanimentEngine';

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
export class AccompanimentConverter implements IMIDIConverter {
  protected _timemap?: MeasureTimemap;
  protected _midi?: ArrayBuffer;
  protected _bandOptions: BandOptions;

  constructor(bandOptions: BandOptions = {}) {
    this._bandOptions = {
      introMode: 'auto',
      introIntensity: 'medium',
      bandEnergy: 'medium',
      outputMode: 'solo-and-band',
      drummerPracticeMode: true,
      ...bandOptions,
    };
  }

  async initialize(
    musicXml: string,
    options: Required<PlayerOptions>,
  ): Promise<void> {
    // Unroll the MusicXML to expand repeats and jumps
    let finalMusicXml = musicXml;

    if (options.unroll !== false) {
      try {
        const unrolled = await unrollMusicXml(
          musicXml,
          options.unrollXslUri,
          options.xsltProcessor,
        );

        // Only use unrolled version if it has notes
        if ((unrolled.match(/<note[\s>]/g) || []).length > 0) {
          finalMusicXml = unrolled;
        } else {
          console.warn(
            '[AccompanimentConverter] Unroll produced empty score, using original MusicXML',
          );
        }
      } catch (error) {
        console.warn(
          '[AccompanimentConverter] Unroll failed, using original MusicXML:',
          error,
        );
      }
    }

    // Generate MIDI with band accompaniment
    try {
      const midiObj = await generateBandMidiFromMusicXML(
        finalMusicXml,
        this._bandOptions,
      );

      // Convert Midi object to ArrayBuffer
      this._midi = midiObj.toArray().buffer;
    } catch (error) {
      throw new Error(
        `[AccompanimentConverter] Failed to generate band MIDI: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    // Generate timemap from MusicXML
    this._timemap = await parseMusicXmlTimemap(
      musicXml,
      options.timemapXslUri,
      options.xsltProcessor,
    );

    // Validate that we have a valid timemap
    if (!this._timemap || this._timemap.length === 0) {
      console.warn(
        '[AccompanimentConverter] No timemap generated, playback sync may be affected',
      );
      this._timemap = [];
    }
  }

  get midi(): ArrayBuffer {
    assertIsDefined(this._midi);
    return this._midi;
  }

  get timemap(): MeasureTimemap {
    assertIsDefined(this._timemap);
    return this._timemap;
  }

  get version(): string {
    return `${pkg.name}/AccompanimentConverter v${pkg.version}`;
  }
}
