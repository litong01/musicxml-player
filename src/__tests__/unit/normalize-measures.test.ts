import { describe, it, expect } from 'vitest';
import { normalizeMeasures } from '../../helpers/normalize-measures';
import { XMLParser } from 'fast-xml-parser';

describe('normalizeMeasures', () => {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    parseAttributeValue: true,
    trimValues: true,
  });

  it('should propagate initial tempo to all measures', () => {
    const input = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
      </attributes>
      <direction>
        <sound tempo="120"/>
      </direction>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration>
      </note>
    </measure>
    <measure number="2">
      <note>
        <pitch><step>D</step><octave>4</octave></pitch>
        <duration>4</duration>
      </note>
    </measure>
    <measure number="3">
      <note>
        <pitch><step>E</step><octave>4</octave></pitch>
        <duration>4</duration>
      </note>
    </measure>
  </part>
</score-partwise>`;

    const result = normalizeMeasures(input, input);
    const doc = parser.parse(result);
    const measures = doc['score-partwise'].part.measure;

    // All measures should have tempo
    expect(measures[0].direction.sound['@_tempo']).toBe(120);
    expect(measures[1].direction.sound['@_tempo']).toBe(120);
    expect(measures[2].direction.sound['@_tempo']).toBe(120);
  });

  it('should preserve tempo changes', () => {
    const input = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
      </attributes>
      <direction>
        <sound tempo="120"/>
      </direction>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration>
      </note>
    </measure>
    <measure number="2">
      <note>
        <pitch><step>D</step><octave>4</octave></pitch>
        <duration>4</duration>
      </note>
    </measure>
    <measure number="3">
      <direction>
        <sound tempo="90"/>
      </direction>
      <note>
        <pitch><step>E</step><octave>4</octave></pitch>
        <duration>4</duration>
      </note>
    </measure>
    <measure number="4">
      <note>
        <pitch><step>F</step><octave>4</octave></pitch>
        <duration>4</duration>
      </note>
    </measure>
  </part>
</score-partwise>`;

    const result = normalizeMeasures(input, input);
    const doc = parser.parse(result);
    const measures = doc['score-partwise'].part.measure;

    // Measures 1-2 should have 120 BPM
    expect(measures[0].direction.sound['@_tempo']).toBe(120);
    expect(measures[1].direction.sound['@_tempo']).toBe(120);

    // Measures 3-4 should have 90 BPM
    expect(measures[2].direction.sound['@_tempo']).toBe(90);
    expect(measures[3].direction.sound['@_tempo']).toBe(90);
  });

  it('should propagate divisions to all measures', () => {
    const input = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>2</divisions>
      </attributes>
      <direction>
        <sound tempo="120"/>
      </direction>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration>
      </note>
    </measure>
    <measure number="2">
      <note>
        <pitch><step>D</step><octave>4</octave></pitch>
        <duration>4</duration>
      </note>
    </measure>
    <measure number="3">
      <note>
        <pitch><step>E</step><octave>4</octave></pitch>
        <duration>4</duration>
      </note>
    </measure>
  </part>
</score-partwise>`;

    const result = normalizeMeasures(input, input);
    const doc = parser.parse(result);
    const measures = doc['score-partwise'].part.measure;

    // All measures should have divisions
    expect(measures[0].attributes.divisions).toBe(2);
    expect(measures[1].attributes.divisions).toBe(2);
    expect(measures[2].attributes.divisions).toBe(2);
  });

  it('should handle multiple tempo changes correctly', () => {
    const input = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
      </attributes>
      <direction>
        <sound tempo="120"/>
      </direction>
    </measure>
    <measure number="2">
    </measure>
    <measure number="3">
      <direction>
        <sound tempo="90"/>
      </direction>
    </measure>
    <measure number="4">
    </measure>
    <measure number="5">
      <direction>
        <sound tempo="100"/>
      </direction>
    </measure>
    <measure number="6">
    </measure>
  </part>
</score-partwise>`;

    const result = normalizeMeasures(input, input);
    const doc = parser.parse(result);
    const measures = doc['score-partwise'].part.measure;

    expect(measures[0].direction.sound['@_tempo']).toBe(120);
    expect(measures[1].direction.sound['@_tempo']).toBe(120);
    expect(measures[2].direction.sound['@_tempo']).toBe(90);
    expect(measures[3].direction.sound['@_tempo']).toBe(90);
    expect(measures[4].direction.sound['@_tempo']).toBe(100);
    expect(measures[5].direction.sound['@_tempo']).toBe(100);
  });

  it('should not duplicate tempo if already present', () => {
    const input = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
      </attributes>
      <direction>
        <sound tempo="120"/>
      </direction>
    </measure>
  </part>
</score-partwise>`;

    const result = normalizeMeasures(input, input);
    const doc = parser.parse(result);
    const measure = doc['score-partwise'].part.measure;

    // Should have exactly one direction element
    const directions = Array.isArray(measure.direction)
      ? measure.direction
      : [measure.direction];

    expect(directions.length).toBe(1);
    expect(directions[0].sound['@_tempo']).toBe(120);
  });

  it('should handle unrolled repeats with tempo changes', () => {
    // Simulates Blue Bag Folly structure
    // ORIGINAL: measures 1-14 at 120 BPM, 15+ at 90 BPM
    const original = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions></attributes>
      <direction><sound tempo="120"/></direction>
    </measure>
    <measure number="11"></measure>
    <measure number="12"></measure>
    <measure number="13"></measure>
    <measure number="14"></measure>
    <measure number="15">
      <direction><sound tempo="90"/></direction>
    </measure>
    <measure number="16"></measure>
  </part>
</score-partwise>`;

    // UNROLLED: After expanding repeats - measure numbers preserved
    const unrolled = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions></attributes>
      <direction><sound tempo="120"/></direction>
    </measure>
    <measure number="11"></measure>
    <measure number="12"></measure>
    <measure number="13"></measure>
    <measure number="14"></measure>
    <measure number="11"></measure>
    <measure number="12"></measure>
    <measure number="13"></measure>
    <measure number="14"></measure>
    <measure number="15">
      <direction><sound tempo="90"/></direction>
    </measure>
    <measure number="16"></measure>
    <measure number="11"></measure>
    <measure number="12"></measure>
    <measure number="15"></measure>
    <measure number="16"></measure>
  </part>
</score-partwise>`;

    const result = normalizeMeasures(unrolled, original);
    const doc = parser.parse(result);
    const measures = doc['score-partwise'].part.measure;

    // ALL instances of measures 1-14 should be 120 BPM (based on original measure number)
    expect(measures[0].direction.sound['@_tempo']).toBe(120); // m1
    expect(measures[1].direction.sound['@_tempo']).toBe(120); // m11 (first occurrence)
    expect(measures[4].direction.sound['@_tempo']).toBe(120); // m14 (first occurrence)
    expect(measures[5].direction.sound['@_tempo']).toBe(120); // m11 (second occurrence)
    expect(measures[8].direction.sound['@_tempo']).toBe(120); // m14 (second occurrence)

    // ALL instances of measures 15+ should be 90 BPM
    expect(measures[9].direction.sound['@_tempo']).toBe(90); // m15 (first occurrence)
    expect(measures[10].direction.sound['@_tempo']).toBe(90); // m16 (first occurrence)

    // Third occurrence of measures 11-12 should still be 120 BPM
    expect(measures[11].direction.sound['@_tempo']).toBe(120); // m11 (third occurrence)
    expect(measures[12].direction.sound['@_tempo']).toBe(120); // m12 (third occurrence)

    // Second occurrence of measure 15 should be 90 BPM
    expect(measures[13].direction.sound['@_tempo']).toBe(90); // m15 (second occurrence)
    expect(measures[14].direction.sound['@_tempo']).toBe(90); // m16 (second occurrence)
  });

  it('should return original XML if no score-partwise found', () => {
    const input = `<?xml version="1.0" encoding="UTF-8"?>
<invalid-root>
</invalid-root>`;

    const result = normalizeMeasures(input, input);
    expect(result).toBe(input);
  });
});
