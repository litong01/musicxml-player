/**
 * Example: Using AccompanimentConverter
 *
 * This example shows how to use the AccompanimentConverter to generate
 * MIDI files with piano, bass, and drum accompaniment from MusicXML.
 */

import { AccompanimentConverter } from '../src/AccompanimentConverter';
import { parseMusicXmlTimemap } from '../src/helpers';
import { SaxonJSProcessor } from '../src/SaxonJSProcessor';
import fs from 'fs';

// Sample MusicXML with a simple melody
const simpleMusicXml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="3.1">
  <part-list>
    <score-part id="P1">
      <part-name>Melody</part-name>
    </score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>4</divisions>
        <key>
          <fifths>0</fifths>
        </key>
        <time>
          <beats>4</beats>
          <beat-type>4</beat-type>
        </time>
        <clef>
          <sign>G</sign>
          <line>2</line>
        </clef>
      </attributes>
      <direction placement="above">
        <direction-type>
          <metronome>
            <beat-unit>quarter</beat-unit>
            <per-minute>120</per-minute>
          </metronome>
        </direction-type>
        <sound tempo="120"/>
      </direction>
      <note>
        <pitch>
          <step>C</step>
          <octave>5</octave>
        </pitch>
        <duration>4</duration>
        <type>quarter</type>
      </note>
      <note>
        <pitch>
          <step>E</step>
          <octave>5</octave>
        </pitch>
        <duration>4</duration>
        <type>quarter</type>
      </note>
      <note>
        <pitch>
          <step>G</step>
          <octave>5</octave>
        </pitch>
        <duration>4</duration>
        <type>quarter</type>
      </note>
      <note>
        <pitch>
          <step>C</step>
          <octave>6</octave>
        </pitch>
        <duration>4</duration>
        <type>quarter</type>
      </note>
    </measure>
    <measure number="2">
      <note>
        <pitch>
          <step>D</step>
          <octave>5</octave>
        </pitch>
        <duration>4</duration>
        <type>quarter</type>
      </note>
      <note>
        <pitch>
          <step>F</step>
          <octave>5</octave>
        </pitch>
        <duration>4</duration>
        <type>quarter</type>
      </note>
      <note>
        <pitch>
          <step>A</step>
          <octave>5</octave>
        </pitch>
        <duration>4</duration>
        <type>quarter</type>
      </note>
      <note>
        <pitch>
          <step>D</step>
          <octave>6</octave>
        </pitch>
        <duration>4</duration>
        <type>quarter</type>
      </note>
    </measure>
  </part>
</score-partwise>`;

async function main() {
  console.log('🎵 AccompanimentConverter Example\n');

  // Create converter with different band energy settings
  const configs = [
    { name: 'Soft Band', bandEnergy: 'soft' as const },
    { name: 'Medium Band', bandEnergy: 'medium' as const },
    { name: 'Strong Band', bandEnergy: 'strong' as const },
  ];

  for (const config of configs) {
    console.log(`\n📀 Generating MIDI with ${config.name}...`);

    const converter = new AccompanimentConverter({
      bandEnergy: config.bandEnergy,
      outputMode: 'solo-and-band',
      drummerPracticeMode: true,
    });

    // Initialize with the MusicXML
    await converter.initialize(simpleMusicXml, {
      musicXml: simpleMusicXml,
      container: 'example',
      soundfontUri: '',
      timemapXslUri: 'https://example.com/timemap.xsl',
      unrollXslUri: 'https://example.com/unroll.xsl',
      xsltProcessor: 'saxon',
      unroll: false,
    });

    // Get the generated MIDI
    const midiBuffer = converter.midi;
    console.log(`   ✓ Generated MIDI: ${midiBuffer.byteLength} bytes`);
    console.log(`   ✓ Version: ${converter.version}`);
    console.log(`   ✓ Timemap entries: ${converter.timemap.length}`);

    // Save to file (optional)
    const filename = `example-${config.bandEnergy}.mid`;
    fs.writeFileSync(filename, Buffer.from(midiBuffer));
    console.log(`   ✓ Saved to: ${filename}`);
  }

  console.log('\n✅ Done! MIDI files have been generated with accompaniment.');
  console.log('\nWhat was generated:');
  console.log('  • Original melody track');
  console.log('  • Piano accompaniment (chord voicings)');
  console.log('  • Bass line (roots and fifths)');
  console.log('  • Drum pattern (kick, snare, hi-hat)');
}

main().catch(console.error);
