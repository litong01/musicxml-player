/**
 * Transpose a MusicXML document by a given number of semitones.
 * Handles proper enharmonic spelling based on the key signature.
 *
 * @param musicXml The MusicXML string to transpose
 * @param semitones Number of semitones to transpose (positive = up, negative = down)
 * @returns The transposed MusicXML string
 */
export function transposeMusicXml(musicXml: string, semitones: number): string {
  if (semitones === 0) return musicXml;

  // Use native DOM parser
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(musicXml, 'text/xml');

  // Check for parsing errors
  const parserError = xmlDoc.querySelector('parsererror');
  if (parserError) {
    return musicXml; // Return original on error
  }

  // Track current key signature (fifths) for each part
  const partKeys: Map<string, number> = new Map();

  // Get all parts
  const parts = xmlDoc.querySelectorAll('part');
  parts.forEach((part) => {
    const partId = part.getAttribute('id') || '';
    partKeys.set(partId, 0); // Default to C major

    // Transpose key signatures
    const keys = part.querySelectorAll('key');
    keys.forEach((key) => {
      const fifthsEl = key.querySelector('fifths');
      if (fifthsEl && fifthsEl.textContent) {
        const oldFifths = parseInt(fifthsEl.textContent);
        const newFifths = transposeKeySignature(oldFifths, semitones);
        fifthsEl.textContent = newFifths.toString();
        partKeys.set(partId, newFifths);
      }
    });

    // Transpose pitches
    const pitches = part.querySelectorAll('pitch');
    pitches.forEach((pitch) => {
      transposePitchElement(pitch, semitones, partKeys.get(partId) || 0);
    });

    // Transpose harmony (chord symbols)
    const harmonies = part.querySelectorAll('harmony');
    harmonies.forEach((harmony) => {
      transposeHarmonyElement(harmony, semitones);
    });
  });

  // Serialize back to string
  const serializer = new XMLSerializer();
  return serializer.serializeToString(xmlDoc);
}

/**
 * Transpose a key signature by semitones.
 * Maps semitones to fifths change in the circle of fifths.
 */
function transposeKeySignature(oldFifths: number, semitones: number): number {
  // Map semitones (0-11) to change in fifths
  // This represents moving around the circle of fifths
  const semitonesToFifths = [
    0, // 0 semitones = no change
    7, // 1 semitone (C to C#) = +7 fifths (or -5 for Db)
    2, // 2 semitones (C to D) = +2 fifths
    -3, // 3 semitones (C to Eb) = -3 fifths
    4, // 4 semitones (C to E) = +4 fifths
    -1, // 5 semitones (C to F) = -1 fifth
    6, // 6 semitones (C to F#/Gb) = +6 or -6 fifths
    1, // 7 semitones (C to G) = +1 fifth
    -4, // 8 semitones (C to Ab) = -4 fifths
    3, // 9 semitones (C to A) = +3 fifths
    -2, // 10 semitones (C to Bb) = -2 fifths
    5, // 11 semitones (C to B) = +5 fifths
  ];

  // Normalize semitones to 0-11 range
  const normalizedSemitones = ((semitones % 12) + 12) % 12;
  const fifthsChange = semitonesToFifths[normalizedSemitones];

  // Apply the change
  let newFifths = oldFifths + fifthsChange;

  // Keep within reasonable range (-7 to 7)
  // If outside, use enharmonic equivalent
  if (newFifths > 7) {
    newFifths -= 12;
  } else if (newFifths < -7) {
    newFifths += 12;
  }

  return newFifths;
}

/**
 * Transpose a single pitch element
 */
function transposePitchElement(
  pitch: Element,
  semitones: number,
  keyFifths: number,
): void {
  const stepEl = pitch.querySelector('step');
  const alterEl = pitch.querySelector('alter');
  const octaveEl = pitch.querySelector('octave');

  if (!stepEl || !stepEl.textContent || !octaveEl || !octaveEl.textContent)
    return;

  const step = stepEl.textContent;
  const alter = alterEl?.textContent ? parseInt(alterEl.textContent) : 0;
  const octave = parseInt(octaveEl.textContent);

  // Convert to MIDI note number
  const stepValues: Record<string, number> = {
    C: 0,
    D: 2,
    E: 4,
    F: 5,
    G: 7,
    A: 9,
    B: 11,
  };
  const midiNote = stepValues[step] + alter + (octave + 1) * 12;

  // Transpose
  const newMidiNote = midiNote + semitones;
  const newOctave = Math.floor(newMidiNote / 12) - 1;

  // Get the correct enharmonic spelling
  const { step: newStep, alter: newAlter } = getEnharmonicSpelling(
    newMidiNote % 12,
    keyFifths,
    semitones > 0,
  );

  // Update the pitch
  stepEl.textContent = newStep;
  octaveEl.textContent = newOctave.toString();

  if (newAlter !== 0) {
    if (alterEl) {
      alterEl.textContent = newAlter.toString();
    } else {
      // Create alter element if it doesn't exist
      const newAlterEl = pitch.ownerDocument.createElement('alter');
      newAlterEl.textContent = newAlter.toString();
      // Insert after step, before octave
      pitch.insertBefore(newAlterEl, octaveEl);
    }
  } else {
    // Remove alter element if it exists and new alter is 0
    if (alterEl) {
      pitch.removeChild(alterEl);
    }
  }
}

/**
 * Transpose harmony/chord symbols
 */
function transposeHarmonyElement(harmony: Element, semitones: number): void {
  // Transpose root
  const root = harmony.querySelector('root');
  if (root) {
    const rootStepEl = root.querySelector('root-step');
    const rootAlterEl = root.querySelector('root-alter');

    if (rootStepEl && rootStepEl.textContent) {
      const stepValues: Record<string, number> = {
        C: 0,
        D: 2,
        E: 4,
        F: 5,
        G: 7,
        A: 9,
        B: 11,
      };
      const alter = rootAlterEl?.textContent
        ? parseInt(rootAlterEl.textContent)
        : 0;
      const chromaticValue =
        (stepValues[rootStepEl.textContent] + alter + semitones + 12) % 12;

      const { step: newStep, alter: newAlter } = getEnharmonicSpelling(
        chromaticValue,
        0,
        semitones > 0,
      );

      rootStepEl.textContent = newStep;
      if (newAlter !== 0) {
        if (rootAlterEl) {
          rootAlterEl.textContent = newAlter.toString();
        } else {
          const newAlterEl = harmony.ownerDocument.createElement('root-alter');
          newAlterEl.textContent = newAlter.toString();
          root.appendChild(newAlterEl);
        }
      } else if (rootAlterEl) {
        root.removeChild(rootAlterEl);
      }
    }
  }

  // Transpose bass
  const bass = harmony.querySelector('bass');
  if (bass) {
    const bassStepEl = bass.querySelector('bass-step');
    const bassAlterEl = bass.querySelector('bass-alter');

    if (bassStepEl && bassStepEl.textContent) {
      const stepValues: Record<string, number> = {
        C: 0,
        D: 2,
        E: 4,
        F: 5,
        G: 7,
        A: 9,
        B: 11,
      };
      const alter = bassAlterEl?.textContent
        ? parseInt(bassAlterEl.textContent)
        : 0;
      const chromaticValue =
        (stepValues[bassStepEl.textContent] + alter + semitones + 12) % 12;

      const { step: newStep, alter: newAlter } = getEnharmonicSpelling(
        chromaticValue,
        0,
        semitones > 0,
      );

      bassStepEl.textContent = newStep;
      if (newAlter !== 0) {
        if (bassAlterEl) {
          bassAlterEl.textContent = newAlter.toString();
        } else {
          const newAlterEl = harmony.ownerDocument.createElement('bass-alter');
          newAlterEl.textContent = newAlter.toString();
          bass.appendChild(newAlterEl);
        }
      } else if (bassAlterEl) {
        bass.removeChild(bassAlterEl);
      }
    }
  }
}

/**
 * Determine the correct enharmonic spelling for a chromatic pitch class
 * based on the key signature and direction of transposition
 */
function getEnharmonicSpelling(
  chromaticValue: number,
  keyFifths: number,
  _transposingUp: boolean,
): { step: string; alter: number } {
  // Normalize chromatic value to 0-11 range
  chromaticValue = ((chromaticValue % 12) + 12) % 12;

  // Define preferred spellings based on key signature
  // Positive fifths = sharps, negative fifths = flats
  const sharpKeys = keyFifths > 0;
  const flatKeys = keyFifths < 0;

  // Enharmonic spelling preferences
  const spellings: Record<
    number,
    Array<{ step: string; alter: number; preference: number }>
  > = {
    0: [{ step: 'C', alter: 0, preference: 0 }],
    1: [
      { step: 'C', alter: 1, preference: sharpKeys ? 0 : 1 },
      { step: 'D', alter: -1, preference: flatKeys ? 0 : 1 },
    ],
    2: [{ step: 'D', alter: 0, preference: 0 }],
    3: [
      { step: 'D', alter: 1, preference: sharpKeys ? 0 : 1 },
      { step: 'E', alter: -1, preference: flatKeys ? 0 : 1 },
    ],
    4: [{ step: 'E', alter: 0, preference: 0 }],
    5: [{ step: 'F', alter: 0, preference: 0 }],
    6: [
      { step: 'F', alter: 1, preference: sharpKeys ? 0 : 1 },
      { step: 'G', alter: -1, preference: flatKeys ? 0 : 1 },
    ],
    7: [{ step: 'G', alter: 0, preference: 0 }],
    8: [
      { step: 'G', alter: 1, preference: sharpKeys ? 0 : 1 },
      { step: 'A', alter: -1, preference: flatKeys ? 0 : 1 },
    ],
    9: [{ step: 'A', alter: 0, preference: 0 }],
    10: [
      { step: 'A', alter: 1, preference: sharpKeys ? 0 : 1 },
      { step: 'B', alter: -1, preference: flatKeys ? 0 : 1 },
    ],
    11: [{ step: 'B', alter: 0, preference: 0 }],
  };

  const options = spellings[chromaticValue];
  if (options.length === 1) {
    return options[0];
  }

  // Choose based on preference (key signature context)
  options.sort((a, b) => a.preference - b.preference);
  return options[0];
}
