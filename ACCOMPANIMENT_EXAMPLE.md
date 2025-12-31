# Using AccompanimentConverter

The `AccompanimentConverter` generates MIDI files with full band accompaniment (piano, bass, drums) from MusicXML scores. **This is now fully implemented and working!**

## How It Works

The converter:

1. **Parses MusicXML** to extract melody notes and musical context
2. **Detects key signature** from the score
3. **Infers chord progressions** based on melody analysis
4. **Generates accompaniment tracks**:
   - **Piano**: Chord voicings with proper inversions
   - **Bass**: Root notes and fifths following the harmony
   - **Drums**: Basic beat pattern (kick, snare, hi-hat)
5. **Expands repeats** automatically for proper playback

## Basic Usage

```typescript
import { Player, AccompanimentConverter } from 'musicxml-player';

// Create converter with default options
const converter = new AccompanimentConverter();

// Or with custom band options
const converter = new AccompanimentConverter({
  introMode: 'auto', // 'auto' | 'always' | 'none'
  introIntensity: 'medium', // 'soft' | 'medium' | 'strong'
  bandEnergy: 'strong', // 'soft' | 'medium' | 'strong'
  outputMode: 'solo-and-band', // 'solo-only' | 'band-only' | 'solo-and-band'
  drummerPracticeMode: true, // for percussion scores: invent harmony + band
});

// Use with Player
const player = await Player.create({
  musicXml: yourMusicXmlString,
  container: 'sheet-container',
  converter: converter,
  // ... other options
});
```

## Band Options

### `introMode`

How intro measures behave:

- `'auto'` (default): Automatically detect intro measures
- `'always'`: Always add an intro
- `'none'`: No intro

### `introIntensity`

How strong the intro is:

- `'soft'`: Minimal intro
- `'medium'` (default): Balanced intro
- `'strong'`: Full-energy intro

### `bandEnergy`

Overall band density and energy:

- `'soft'`: Sparse, minimal accompaniment
- `'medium'` (default): Balanced band parts
- `'strong'`: Dense, energetic accompaniment

### `outputMode`

Which tracks to include in output:

- `'solo-only'`: Only the melody/original drums
- `'band-only'`: Only the generated band parts
- `'solo-and-band'` (default): Both solo and band

### `drummerPracticeMode`

For percussion-only scores:

- `true` (default): Generate harmony and full band
- `false`: Only output the original drums

## How It Works

### For Pitched Scores (Melody)

1. Extracts the melody from the MusicXML
2. Detects the key
3. Infers chord progression from the melody
4. Generates:
   - Piano accompaniment (chord voicings with fills)
   - Bass line (roots and fifths)
   - Drum kit pattern (kick, snare, hi-hat, fills)

### For Percussion Scores (Drums)

1. Extracts the original drum parts
2. If `drummerPracticeMode` is enabled:
   - Generates a generic chord progression (I-V-vi-IV)
   - Creates piano, bass, and pad accompaniment
3. Outputs original drums + band tracks

## Complete Example

```typescript
import { Player, AccompanimentConverter } from 'musicxml-player';

async function createPlayerWithBand(musicXml: string) {
  // Create converter with strong energy for practice
  const converter = new AccompanimentConverter({
    bandEnergy: 'strong',
    outputMode: 'solo-and-band',
    drummerPracticeMode: true,
  });

  const player = await Player.create({
    musicXml: musicXml,
    container: 'sheet-container',
    converter: converter,
    soundfontUri: 'path/to/soundfont.sf3',
    // ... other options
  });

  return player;
}

// Usage
const musicXmlContent = await fetch('score.musicxml').then((r) => r.text());
const player = await createPlayerWithBand(musicXmlContent);
player.play();
```

## Fallback Strategy

You can use `AccompanimentConverter` as a fallback when MIDI files are not available:

```typescript
async function createConverterWithFallback(sheet: string) {
  const midiUrl = sheet.replace(/\.\w+$/, '.mid');

  try {
    // Try to fetch existing MIDI file
    await fetch(midiUrl, { method: 'HEAD' });
    return new FetchConverter(midiUrl);
  } catch {
    // If no MIDI file exists, generate with accompaniment
    console.log('No MIDI file found, generating with band accompaniment');
    return new AccompanimentConverter({
      bandEnergy: 'medium',
      outputMode: 'solo-and-band',
    });
  }
}
```

## Integration with Demo

To add to the demo's converter selection:

```javascript
// In demo.mjs createConverter function:
case 'accomp':
  return new AccompanimentConverter({
    bandEnergy: 'medium',
    outputMode: 'solo-and-band',
    drummerPracticeMode: true,
  });
```

Then add an option in the HTML:

```html
<select id="converter">
  <option value="vrv">Verovio</option>
  <option value="midi">MIDI</option>
  <option value="mma">MMA</option>
  <option value="accomp">Accompaniment</option>
</select>
```
