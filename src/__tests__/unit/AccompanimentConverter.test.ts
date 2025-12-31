import { describe, it, expect, beforeEach } from 'vitest';
import { AccompanimentConverter } from '../../AccompanimentConverter';
import { PlayerOptions } from '../../Player';

describe('AccompanimentConverter', () => {
  let converter: AccompanimentConverter;

  beforeEach(() => {
    converter = new AccompanimentConverter({
      bandEnergy: 'medium',
      outputMode: 'solo-and-band',
    });
  });

  it('should create instance with default options', () => {
    const defaultConverter = new AccompanimentConverter();
    expect(defaultConverter).toBeDefined();
  });

  it('should initialize with simple MusicXML', async () => {
    const simpleMusicXml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="3.1">
  <part-list>
    <score-part id="P1">
      <part-name>Piano</part-name>
    </score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
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
      <note>
        <pitch>
          <step>C</step>
          <octave>4</octave>
        </pitch>
        <duration>4</duration>
        <type>whole</type>
      </note>
    </measure>
  </part>
</score-partwise>`;

    const options: Required<PlayerOptions> = {
      musicXml: simpleMusicXml,
      container: 'test-container',
      soundfontUri: 'test.sf3',
      timemapXslUri: 'https://example.com/timemap.xsl',
      unrollXslUri: 'https://example.com/unroll.xsl',
      xsltProcessor: 'saxon',
      unroll: false,
    };

    await converter.initialize(simpleMusicXml, options);

    expect(converter.midi).toBeDefined();
    expect(converter.midi.byteLength).toBeGreaterThan(0);
    expect(converter.timemap).toBeDefined();
    expect(converter.version).toContain('AccompanimentConverter');
  });

  it('should handle percussion scores', async () => {
    const percussionMusicXml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="3.1">
  <part-list>
    <score-part id="P1">
      <part-name>Drums</part-name>
    </score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <time>
          <beats>4</beats>
          <beat-type>4</beat-type>
        </time>
      </attributes>
      <note>
        <unpitched>
          <display-step>F</display-step>
          <display-octave>4</display-octave>
        </unpitched>
        <duration>1</duration>
        <type>quarter</type>
      </note>
    </measure>
  </part>
</score-partwise>`;

    const options: Required<PlayerOptions> = {
      musicXml: percussionMusicXml,
      container: 'test-container',
      soundfontUri: 'test.sf3',
      timemapXslUri: 'https://example.com/timemap.xsl',
      unrollXslUri: 'https://example.com/unroll.xsl',
      xsltProcessor: 'saxon',
      unroll: false,
    };

    const percConverter = new AccompanimentConverter({
      drummerPracticeMode: true,
      outputMode: 'solo-and-band',
    });

    await percConverter.initialize(percussionMusicXml, options);

    expect(percConverter.midi).toBeDefined();
    expect(percConverter.midi.byteLength).toBeGreaterThan(0);
  });

  it('should respect outputMode options', () => {
    const soloOnly = new AccompanimentConverter({ outputMode: 'solo-only' });
    const bandOnly = new AccompanimentConverter({ outputMode: 'band-only' });
    const both = new AccompanimentConverter({ outputMode: 'solo-and-band' });

    expect(soloOnly).toBeDefined();
    expect(bandOnly).toBeDefined();
    expect(both).toBeDefined();
  });
});
