import { assertIsDefined } from './helpers';
import type { ISheetRenderer } from './interfaces/ISheetRenderer';
import type { MeasureTimemap } from './interfaces/IMIDIConverter';
import type {
  MeasureIndex,
  MillisecsTimestamp,
  Player,
  PlayerOptions,
} from './Player';
import {
  IOSMDOptions,
  MusicPartManagerIterator,
  OpenSheetMusicDisplay,
  VexFlowVoiceEntry,
  VexFlowMusicSheetCalculator,
  EngravingRules,
} from 'opensheetmusicdisplay';

export type EngravingRulesOptions = {
  [Prop in keyof EngravingRules]: EngravingRules[Prop];
};

/**
 * Implementation of ISheetRenderer that uses OpenSheetMusicDisplay @see https://github.com/opensheetmusicdisplay/opensheetmusicdisplay
 */
export class OpenSheetMusicDisplayRenderer implements ISheetRenderer {
  player?: Player;
  protected _osmd: OpenSheetMusicDisplay | undefined;
  protected _currentMeasureIndex: MeasureIndex = 0;
  protected _currentVoiceEntryIndex: number = 0;
  protected _osmdOptions: IOSMDOptions;
  protected _timemap: MeasureTimemap = [];

  constructor(
    osmdOptions?: IOSMDOptions,
    protected _engravingOptions?: EngravingRulesOptions,
  ) {
    this._osmdOptions = { ...osmdOptions };
  }

  /**
   * Generate a timemap compatible with OSMD's timing calculations.
   * This timemap uses OSMD's internal measure structure and timing.
   */
  generateTimemap() {
    assertIsDefined(this._osmd);
    const timemap: Array<{
      measure: number;
      timestamp: number;
      duration: number;
    }> = [];

    let cumulativeTime = 0;
    this._osmd.Sheet.SourceMeasures.forEach((measure, index) => {
      // Calculate full measure duration based on time signature and tempo
      // duration = (beats per measure) * (milliseconds per beat)
      // milliseconds per beat = 60000 / BPM
      const beatsPerMeasure = measure.Duration.RealValue * 4; // Convert to quarter note units
      const millisecsPerBeat = 60000 / measure.TempoInBPM;
      const measureDuration = beatsPerMeasure * millisecsPerBeat;

      timemap.push({
        measure: index,
        timestamp: cumulativeTime,
        duration: measureDuration,
      });

      cumulativeTime += measureDuration;
    });

    return timemap;
  }

  destroy(): void {
    if (!this._osmd) return;
    this._osmd.clear();
    this._osmd = undefined;
  }

  async initialize(
    container: HTMLElement,
    musicXml: string,
    options: Required<PlayerOptions>,
  ): Promise<void> {
    // Adjust options based on PlayerOptions.
    this._osmdOptions = {
      ...{
        backend: 'svg',
        drawFromMeasureNumber: 1,
        drawUpToMeasureNumber: Number.MAX_SAFE_INTEGER, // draw all measures, up to the end of the sample
        drawMeasureNumbers: false,
        newSystemFromXML: false,
        newPageFromXML: false,
        followCursor: true,
        disableCursor: false,
        autoResize: false,
        renderSingleHorizontalStaffline: options.horizontal,
      },
      ...this._osmdOptions,
    };

    // Create the OSMD toolkit.
    this._osmd = new OpenSheetMusicDisplay(container, this._osmdOptions);
    if (this._engravingOptions) {
      let k: keyof EngravingRules;
      for (k in this._engravingOptions) {
        (this._osmd.EngravingRules as any)[k] = this._engravingOptions[k];
      }
    }
    // FIXME: Avoid hard-coding these engraving rules.
    this._osmd.EngravingRules.resetChordAccidentalTexts(
      this._osmd.EngravingRules.ChordAccidentalTexts,
      true,
    );
    this._osmd.EngravingRules.resetChordSymbolLabelTexts(
      this._osmd.EngravingRules.ChordSymbolLabelTexts,
    );
    await this._osmd.load(musicXml);

    // Store the converter's timemap for accurate cursor positioning
    this._timemap = options.converter.timemap;

    // Reset processed entries for new piece
    this._processedTimemapEntries.clear();

    this._redraw();
  }

  // Track which timemap entries we've processed
  private _processedTimemapEntries = new Set<number>();

  moveTo(
    index: MeasureIndex,
    start: MillisecsTimestamp,
    offset: MillisecsTimestamp,
  ): void {
    assertIsDefined(this._osmd);

    // If we've already processed all timemap entries, stop immediately
    if (this._processedTimemapEntries.size >= this._timemap.length) {
      return;
    }

    // Find which timemap entry this corresponds to and mark it as processed
    const TOLERANCE = 10;
    const timemapIndex = this._timemap.findIndex(
      (entry) =>
        entry.measure === index &&
        Math.abs(entry.timestamp - start) < TOLERANCE,
    );

    if (timemapIndex >= 0) {
      this._processedTimemapEntries.add(timemapIndex);
    }

    // Timemap uses milliseconds, so compare directly

    const measure = this._osmd.Sheet.SourceMeasures[index];

    if (!measure) {
      console.warn(`[OSMD] No measure found at index ${index}`);
      return;
    }

    // Find the correct timemap entry by timestamp, not by index
    // This handles cases where the same measure number appears multiple times (repeats)
    let timemapEntry = this._timemap.find(
      (entry) =>
        entry.measure === index &&
        Math.abs(entry.timestamp - start) < TOLERANCE,
    );

    // Fallback: if exact match not found, use the entry closest to current time
    if (!timemapEntry) {
      const candidateEntries = this._timemap.filter(
        (entry) => entry.measure === index,
      );
      if (candidateEntries.length > 0) {
        timemapEntry = candidateEntries.reduce((closest, entry) =>
          Math.abs(entry.timestamp - start) <
          Math.abs(closest.timestamp - start)
            ? entry
            : closest,
        );
      }
    }

    if (!timemapEntry) {
      console.warn(
        `[OSMD] No timemap entry found for measure ${index} at ${(start / 1000).toFixed(2)}s (${start}ms)`,
      );
      return;
    }

    const measureDuration = timemapEntry.duration;
    const measureMusicalDuration = measure.Duration.RealValue;

    if (measureMusicalDuration <= 0) {
      return;
    }

    // Find the voice entry closest to the playback offset.
    // Iterate backwards to find the last entry that starts before or at the offset.
    for (
      let v = measure.VerticalSourceStaffEntryContainers.length - 1;
      v >= 0;
      v--
    ) {
      const vsse = measure.VerticalSourceStaffEntryContainers[v]!;

      // Convert OSMD's musical time (whole note units) to seconds
      const vsseTimeRatio = vsse.Timestamp.RealValue / measureMusicalDuration;
      const vsseTime = vsseTimeRatio * (measureDuration / 1000); // measureDuration is in ms, convert to seconds

      if (vsseTime <= offset / 1000 + Number.EPSILON) {
        if (
          this._currentMeasureIndex !== index ||
          this._currentVoiceEntryIndex !== v
        ) {
          this._updateCursor(index, v);
        }

        // After updating cursor, check if we've now processed all entries
        if (this._processedTimemapEntries.size >= this._timemap.length) {
          console.log(
            `[OSMD] Processed all ${this._timemap.length} timemap entries, stopping cursor updates`,
          );
        }

        return;
      }
    }
  }

  onResize(): void {
    if (this._osmd) {
      this._redraw();
    }
  }

  onEvent(): void {}

  get version(): string {
    assertIsDefined(this._osmd);
    return `opensheetmusicdisplay v${this._osmd.Version}`;
  }

  protected _redraw() {
    assertIsDefined(this._osmd);
    if (
      this._osmd.GraphicSheet?.GetCalculator instanceof
      VexFlowMusicSheetCalculator
    ) {
      (
        this._osmd.GraphicSheet.GetCalculator as VexFlowMusicSheetCalculator
      ).beamsNeedUpdate = true;
    }
    if (this._osmd.IsReadyToRender()) {
      this._osmd.render();
      this._osmd.cursor.show();
    }

    // Setup event listeners for target stave notes to position the cursor.
    this._osmd.GraphicSheet.MeasureList?.forEach((measureGroup, index) => {
      measureGroup?.forEach((measure) => {
        measure?.staffEntries?.forEach((se) => {
          se.graphicalVoiceEntries?.forEach((gve) => {
            const vfve = <VexFlowVoiceEntry>gve;
            (<HTMLElement>(
              vfve.vfStaveNote?.getAttribute('el')
            ))?.addEventListener('click', () => {
              // Use the Verovio timemap for accurate positioning
              const timemapEntry = this._timemap[index];
              const measureStart = timemapEntry?.timestamp ?? 0;
              const measureDuration = timemapEntry?.duration ?? 1000;
              const sourceMeasure = measure.parentSourceMeasure;
              const measureMusicalDuration = sourceMeasure.Duration.RealValue;
              const relativeOffsetRatio =
                se.relInMeasureTimestamp.RealValue / measureMusicalDuration;
              const relativeOffset = relativeOffsetRatio * measureDuration;

              this.player?.moveTo(index, measureStart, relativeOffset);
            });
          });
        });
      });
    });
  }

  protected _updateCursor(index: number, voiceEntryIndex: number) {
    assertIsDefined(this._osmd);
    const measure = this._osmd.Sheet.SourceMeasures[index]!;
    const vsse = measure.VerticalSourceStaffEntryContainers[voiceEntryIndex]!;

    this._currentMeasureIndex = index;
    this._currentVoiceEntryIndex = voiceEntryIndex;

    if (index === 0 && voiceEntryIndex === 0) {
      this._osmd.cursor.reset();
    } else {
      const startTimestamp = measure.AbsoluteTimestamp.clone();
      startTimestamp.Add(vsse.Timestamp);
      this._osmd.cursor.iterator = new MusicPartManagerIterator(
        this._osmd.Sheet,
        startTimestamp,
        undefined,
      );
      this._osmd.cursor.update();
    }
  }
}
