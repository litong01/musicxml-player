import {
  VerovioOptions,
  TimeMapEntry,
  toolkit as VerovioToolkit,
} from 'verovio';

export interface TimeMapEntryFixed extends TimeMapEntry {
  restsOn?: string[];
  restsOff?: string[];
  measureOn?: string;
}

export interface ElementsAtTimeFixed {
  notes: string[];
  rests: string[];
  chords: string[];
  page: number;
  measure: string;
}

export interface VerovioToolkitFixed extends VerovioToolkit {
  destroy(): void;
}

export interface VerovioOptionsFixed extends VerovioOptions {
  tuning?: string;
}
