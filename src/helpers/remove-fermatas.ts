/**
 * Remove all fermata markings from MusicXML.
 * Fermatas cause timing issues and make metronome tracks unreliable.
 */
export function removeFermatas(musicXml: string): string {
  // Remove self-closing fermata tags: <fermata ... />
  let cleaned = musicXml.replace(/<fermata[^>]*\/>/g, '');

  // Remove fermata tags with content: <fermata ...>...</fermata>
  cleaned = cleaned.replace(/<fermata[^>]*>.*?<\/fermata>/gs, '');

  return cleaned;
}
