# AccompanimentConverter Implementation

## Overview

The `AccompanimentConverter` is a fully working implementation that generates MIDI files with band accompaniment (piano, bass, drums) from MusicXML scores. It analyzes the melody, detects the key, infers chord progressions, and creates professional-sounding accompaniment tracks.

## Key Features

✅ **Automatic Chord Detection**: Analyzes melody to infer chord progressions  
✅ **Key Signature Detection**: Reads key from MusicXML or detects from notes  
✅ **Multiple Instrument Tracks**: Piano, bass, and drums  
✅ **Configurable Energy Levels**: Soft, medium, or strong band accompaniment  
✅ **Percussion Support**: Special mode for drum-only scores  
✅ **No Hanging Issues**: Carefully designed to avoid infinite loops  
✅ **Repeat Expansion**: Automatically expands repeats in the score

## Usage

### Basic Example

```typescript
import { Player, AccompanimentConverter } from 'musicxml-player';

// Create converter
const converter = new AccompanimentConverter({
  bandEnergy: 'medium',
  outputMode: 'solo-and-band',
});

// Use with Player
const player = await Player.create({
  musicXml: yourMusicXmlString,
  container: 'sheet-container',
  converter: converter,
  soundfontUri: 'path/to/soundfont.sf3',
});

player.play();
```

### Configuration Options

```typescript
interface AccompanimentOptions {
  introMode?: 'auto' | 'always' | 'none'; // Future feature
  introIntensity?: 'soft' | 'medium' | 'strong'; // Future feature
  bandEnergy?: 'soft' | 'medium' | 'strong'; // ✅ Implemented
  outputMode?: 'solo-only' | 'band-only' | 'solo-and-band'; // ✅ Implemented
  drummerPracticeMode?: boolean; // ✅ Implemented
}
```

#### `bandEnergy`

Controls the overall volume and intensity of accompaniment:

- `'soft'`: Gentle, sparse accompaniment (60% volume)
- `'medium'`: Balanced band parts (70% volume) - **Default**
- `'strong'`: Full-energy, dense accompaniment (85% volume)

#### `outputMode`

Determines which tracks are included:

- `'solo-only'`: Only the original melody
- `'band-only'`: Only generated accompaniment tracks
- `'solo-and-band'`: Both melody and band - **Default**

#### `drummerPracticeMode`

For percussion-only scores:

- `true`: Generates harmony (I-V-vi-IV) and full band - **Default**
- `false`: Outputs only original drums

## How It Works

### 1. MusicXML Parsing

- Extracts notes, durations, and rhythms
- Reads key signatures and tempo markings
- Detects if score is pitched or percussion

### 2. Chord Inference

- Analyzes melody notes in time windows (typically 2 beats)
- Identifies pitch classes and intervals
- Maps to diatonic chords in the detected key
- Supports major, minor, dominant 7th, and diminished chords

### 3. Accompaniment Generation

**Piano Track** (Channel 1):

- Chord voicings in the middle register (C3-C5)
- Slightly staccato notes (90% of beat duration)
- Proper voice leading between chords

**Bass Track** (Channel 2):

- Root notes in bass octave (C2-C3)
- Adds fifths on longer chords for movement
- 80% note duration for rhythmic clarity

**Drum Track** (Channel 10):

- Kick drum: Beats 1 and 3
- Snare: Beats 2 and 4
- Hi-hat: Every beat
- Velocity-scaled based on `bandEnergy`

### 4. MIDI Generation

Uses `@tonejs/midi` library to create standard MIDI files with proper:

- Tempo settings
- Channel assignments (1=Piano, 2=Bass, 10=Drums)
- GM instrument numbers
- Note velocities and durations

## Architecture Decisions

### Why No Hanging?

The previous implementation had issues with hanging. This version avoids that by:

1. **Bounded Loops**: All loops have explicit limits based on:
   - Total duration calculated from notes
   - Beat duration from tempo
   - Fixed iteration counts

2. **No Infinite Recursion**: Chord inference uses:
   - Simple rule-based heuristics
   - Fallback to previous chord
   - Default to tonic chord

3. **Async Safety**:
   - All async operations have clear completion
   - No circular async/await chains
   - Proper error handling with try-catch

4. **Deterministic Processing**:
   - No while(true) loops
   - All arrays have known lengths
   - Clear termination conditions

## Limitations & Future Enhancements

### Current Limitations

- Chord detection is rule-based (not ML-based)
- Limited to basic chord types (major, minor, dom7, dim)
- Drum patterns are fixed (no variation)
- No intro/outro generation yet
- Piano voicings don't vary by style

### Planned Enhancements

- [ ] Style-based piano patterns (jazz, pop, classical)
- [ ] More sophisticated chord detection
- [ ] Intro/outro generation
- [ ] Fill patterns for drums
- [ ] Velocity variation for humanization
- [ ] Support for more chord types (sus, aug, etc.)
- [ ] Chord symbol parsing from MusicXML

## Testing

Run the test suite:

```bash
npm test -- AccompanimentConverter
```

All tests pass:

- ✅ Instance creation
- ✅ MusicXML initialization
- ✅ Percussion score handling
- ✅ Output mode configuration

## Integration

### Demo Integration

The converter is integrated into the demo at `/demo/demo.mjs`:

```javascript
case 'accomp':
  return new AccompanimentConverter({
    bandEnergy: 'medium',
    outputMode: g_state.accompanimentMode || 'solo-and-band',
    drummerPracticeMode: true,
  });
```

### Web UI

Users can select accompaniment mode in the settings:

- Solo only
- Band only
- Solo + Band

## Technical Details

### Dependencies

- `@tonejs/midi`: MIDI file generation
- `fast-xml-parser`: MusicXML parsing
- Built-in helpers: `parseMusicXmlTimemap`, `unrollMusicXml`

### Key Signature Mapping

```typescript
const fifthsToRoot: Record<number, number> = {
  0: 5,   // C major
  1: 0,   // G major
  2: 7,   // D major
  -1: 11, // F major
  // ... etc
};
```

### Chord Voicing Example

```typescript
// Major chord (C major)
[C3, E3, G3][ // Root, major 3rd, perfect 5th
  // Minor chord (A minor)
  (A3, C4, E4)
]; // Root, minor 3rd, perfect 5th
```

## Performance

- **Parsing**: Fast XML parsing with `fast-xml-parser`
- **Generation**: Efficient MIDI track building
- **Memory**: Minimal footprint, all in-memory processing
- **No Blocking**: Fully async, non-blocking operations

## Examples

See `/examples/accompaniment-example.ts` for a standalone example that generates MIDI files with different energy levels.

## Support

For issues or questions:

- Check the test file: `src/__tests__/unit/AccompanimentConverter.test.ts`
- See the main implementation: `src/AccompanimentConverter.ts`
- Refer to the example: `examples/accompaniment-example.ts`
