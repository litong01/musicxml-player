# AccompanimentConverter - Quick Start Guide

## What is it?

AccompanimentConverter automatically generates piano, bass, and drum tracks from any MusicXML file, creating a full "band" sound for your melodies.

## Installation

Already included in `@music-i18n/musicxml-player` v1.3.0+

## Quick Example

```typescript
import { Player, AccompanimentConverter } from 'musicxml-player';

// Create player with automatic accompaniment
const player = await Player.create({
  musicXml: yourMusicXmlString,
  container: 'sheet-container',
  converter: new AccompanimentConverter({
    bandEnergy: 'medium', // soft | medium | strong
    outputMode: 'solo-and-band', // solo-only | band-only | solo-and-band
  }),
  soundfontUri: 'soundfont.sf3',
});

player.play(); // Plays with full band accompaniment!
```

## What Gets Generated?

For **any** MusicXML file (melody, vocals, or drums), you get:

✅ **Piano** - Smart chord accompaniment based on melody  
✅ **Bass** - Root notes and fifths following the chords  
✅ **Drums** - Basic rock/pop beat (kick, snare, hi-hat)  
✅ **Original melody** - Preserved and synchronized

## Options

```typescript
{
  bandEnergy: 'soft' | 'medium' | 'strong',
  // Controls volume and density

  outputMode: 'solo-only' | 'band-only' | 'solo-and-band',
  // What tracks to include

  drummerPracticeMode: true | false
  // For drum scores: add harmony band
}
```

## How It Works

1. **Analyzes** your MusicXML melody
2. **Detects** the key signature
3. **Infers** chord progressions from the notes
4. **Generates** piano, bass, and drum MIDI tracks
5. **Synchronizes** everything with the original score

## No Hanging Issues! ✅

This implementation was carefully designed to avoid the infinite loop problems from the previous version:

- All loops are bounded
- No circular async chains
- Deterministic processing
- Proper error handling

## Use in Demo

The web demo supports three accompaniment modes:

1. **Solo only** - Just your melody
2. **Band only** - Just the generated tracks
3. **Solo + Band** - Full experience (recommended!)

Select in Settings → Band Accompaniment

## File Locations

- **Implementation**: `src/AccompanimentConverter.ts`
- **Tests**: `src/__tests__/unit/AccompanimentConverter.test.ts`
- **Example**: `examples/accompaniment-example.ts`
- **Full docs**: `ACCOMPANIMENT_IMPLEMENTATION.md`

## When to Use

✅ Practice tool for musicians  
✅ Quick demos of melodies  
✅ Educational purposes  
✅ When no MIDI file is available  
✅ Creating backing tracks

## When NOT to Use

❌ You need highly sophisticated arrangements  
❌ You have a custom MIDI already  
❌ You need specific jazz voicings  
❌ The melody is very chromatic/atonal

## Next Steps

1. Try it with your MusicXML files
2. Experiment with different `bandEnergy` levels
3. Check the generated MIDI structure
4. Report issues or suggestions!

## Example Output

For a simple C major melody:

- **Measures**: Auto-expanded with repeats
- **Chords**: I - IV - V - I progression
- **Piano**: Root position triads
- **Bass**: C2 - F2 - G2 - C2
- **Drums**: 4/4 rock beat

Happy music making! 🎵
