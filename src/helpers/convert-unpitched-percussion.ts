/**
 * Convert unpitched percussion notes to pitched notes using General MIDI percussion map.
 * This allows Verovio to generate proper MIDI with Note On/Off events.
 */

// General MIDI Level 1 Percussion Key Map (Channel 10)
// Maps instrument names (case-insensitive) to MIDI note numbers
const GM_PERCUSSION_MAP: Record<string, number> = {
  // Bass drums
  'acoustic bass drum': 35,
  'bass drum 1': 36,
  'bass drum 2': 35,
  'bass drum': 36,
  
  // Snare drums
  'side stick': 37,
  'acoustic snare': 38,
  'hand clap': 39,
  'electric snare': 40,
  'snare drum': 38,
  'snare': 38,
  
  // Toms
  'low floor tom': 41,
  'closed hi-hat': 42,
  'high floor tom': 43,
  'pedal hi-hat': 44,
  'low tom': 45,
  'open hi-hat': 46,
  'low-mid tom': 47,
  'hi-mid tom': 48,
  'crash cymbal 1': 49,
  'high tom': 50,
  'ride cymbal 1': 51,
  'chinese cymbal': 52,
  'ride bell': 53,
  'tambourine': 54,
  'splash cymbal': 55,
  'cowbell': 56,
  'crash cymbal 2': 57,
  'vibraslap': 58,
  'ride cymbal 2': 59,
  'hi bongo': 60,
  'low bongo': 61,
  'mute hi conga': 62,
  'open hi conga': 63,
  'low conga': 64,
  'high timbale': 65,
  'low timbale': 66,
  'high agogo': 67,
  'low agogo': 68,
  'cabasa': 69,
  'maracas': 70,
  'short whistle': 71,
  'long whistle': 72,
  'short guiro': 73,
  'long guiro': 74,
  'claves': 75,
  'hi wood block': 76,
  'low wood block': 77,
  'mute cuica': 78,
  'open cuica': 79,
  'mute triangle': 80,
  'open triangle': 81,
  
  // Common variations
  'hi-hat': 42,
  'hihat': 42,
  'cymbal': 49,
  'tom': 47,
  'bongo': 60,
  'conga': 64,
  'timbale': 65,
  'agogo': 67,
  'whistle': 71,
  'guiro': 73,
  'wood block': 76,
  'cuica': 78,
  'triangle': 80,
};

/**
 * Map display-step/octave to MIDI note number as fallback
 */
function displayToMidiNote(step: string, octave: number): number {
  const stepOffsets: Record<string, number> = {
    'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11
  };
  return (octave + 1) * 12 + stepOffsets[step];
}

/**
 * Find MIDI note number for an unpitched instrument
 */
function getPercussionMidiNote(
  instrumentId: string | null,
  scoreInstruments: Map<string, string>,
  displayStep?: string,
  displayOctave?: number
): number {
  // Try to find instrument name from ID
  if (instrumentId) {
    const instrumentName = scoreInstruments.get(instrumentId);
    if (instrumentName) {
      const normalizedName = instrumentName.toLowerCase().trim();
      
      // Try exact match first
      if (GM_PERCUSSION_MAP[normalizedName] !== undefined) {
        return GM_PERCUSSION_MAP[normalizedName];
      }
      
      // Try partial match
      for (const [key, value] of Object.entries(GM_PERCUSSION_MAP)) {
        if (normalizedName.includes(key) || key.includes(normalizedName)) {
          return value;
        }
      }
    }
  }
  
  // Fallback to display position if available
  if (displayStep && displayOctave !== undefined) {
    return displayToMidiNote(displayStep, displayOctave);
  }
  
  // Default to acoustic snare if all else fails
  return 38;
}

/**
 * Convert unpitched percussion notes to pitched notes in MusicXML
 * @param musicXml - MusicXML string content
 * @returns Modified MusicXML with pitched notes
 */
export function convertUnpitchedToPitched(musicXml: string): string {
  // Parse score-instrument definitions to build instrument map
  const scoreInstruments = new Map<string, string>();
  const instrumentRegex = /<score-instrument[^>]*id="([^"]*)"[^>]*>[\s\S]*?<instrument-name>([^<]*)<\/instrument-name>[\s\S]*?<\/score-instrument>/g;
  
  let match;
  while ((match = instrumentRegex.exec(musicXml)) !== null) {
    scoreInstruments.set(match[1], match[2]);
  }
  
  // Convert unpitched notes to pitched
  let result = musicXml;
  
  // Match unpitched elements with optional instrument ID and display info
  const unpitchedRegex = /<note[^>]*>([\s\S]*?)<unpitched>([\s\S]*?)<\/unpitched>([\s\S]*?)<\/note>/g;
  
  result = result.replace(unpitchedRegex, (noteMatch, beforeUnpitched, unpitchedContent, afterUnpitched) => {
    // Extract instrument ID if present
    const instrumentMatch = noteMatch.match(/<instrument[^>]*id="([^"]*)"/);
    const instrumentId = instrumentMatch ? instrumentMatch[1] : null;
    
    // Extract display-step and display-octave
    const stepMatch = unpitchedContent.match(/<display-step>([^<]*)<\/display-step>/);
    const octaveMatch = unpitchedContent.match(/<display-octave>([^<]*)<\/display-octave>/);
    
    const displayStep = stepMatch ? stepMatch[1] : undefined;
    const displayOctave = octaveMatch ? parseInt(octaveMatch[1]) : undefined;
    
    // Get MIDI note number
    const midiNote = getPercussionMidiNote(instrumentId, scoreInstruments, displayStep, displayOctave);
    
    // Convert MIDI note to pitch (step, octave, alter)
    const octave = Math.floor(midiNote / 12) - 1;
    const noteInOctave = midiNote % 12;
    const steps = ['C', 'C', 'D', 'D', 'E', 'F', 'F', 'G', 'G', 'A', 'A', 'B'];
    const alters = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0];
    
    const step = steps[noteInOctave];
    const alter = alters[noteInOctave];
    
    // Build pitch element
    let pitchXml = `<pitch><step>${step}</step>`;
    if (alter !== 0) {
      pitchXml += `<alter>${alter}</alter>`;
    }
    pitchXml += `<octave>${octave}</octave></pitch>`;
    
    // Reconstruct note with pitch instead of unpitched
    return `<note${noteMatch.substring(5, noteMatch.indexOf('>'))}>${beforeUnpitched}${pitchXml}${afterUnpitched}</note>`;
  });
  
  return result;
}
