import type { ISheetRenderer } from './interfaces/ISheetRenderer';
import type { MeasureTimemap } from './interfaces/IMIDIConverter';
import type { MeasureIndex, MillisecsTimestamp, Player, PlayerOptions } from './Player';
import { IOSMDOptions, OpenSheetMusicDisplay, EngravingRules } from 'opensheetmusicdisplay';
export type EngravingRulesOptions = {
    [Prop in keyof EngravingRules]: EngravingRules[Prop];
};
/**
 * Implementation of ISheetRenderer that uses OpenSheetMusicDisplay @see https://github.com/opensheetmusicdisplay/opensheetmusicdisplay
 */
export declare class OpenSheetMusicDisplayRenderer implements ISheetRenderer {
    protected _engravingOptions?: EngravingRulesOptions | undefined;
    player?: Player;
    protected _osmd: OpenSheetMusicDisplay | undefined;
    protected _currentMeasureIndex: MeasureIndex;
    protected _currentVoiceEntryIndex: number;
    protected _osmdOptions: IOSMDOptions;
    protected _timemap: MeasureTimemap;
    constructor(osmdOptions?: IOSMDOptions, _engravingOptions?: EngravingRulesOptions | undefined);
    /**
     * Generate a timemap compatible with OSMD's timing calculations.
     * This timemap uses OSMD's internal measure structure and timing.
     */
    generateTimemap(): {
        measure: number;
        timestamp: number;
        duration: number;
    }[];
    destroy(): void;
    initialize(container: HTMLElement, musicXml: string, options: Required<PlayerOptions>): Promise<void>;
    moveTo(index: MeasureIndex, _start: MillisecsTimestamp, offset: MillisecsTimestamp): void;
    onResize(): void;
    onEvent(): void;
    get version(): string;
    protected _redraw(): void;
    protected _updateCursor(index: number, voiceEntryIndex: number): void;
}
//# sourceMappingURL=OpenSheetMusicDisplayRenderer.d.ts.map