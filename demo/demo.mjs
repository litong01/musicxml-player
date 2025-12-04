import {
  fetish,
  Player,
  MuseScoreConverter,
  MuseScoreRenderer,
  VerovioConverter,
  VerovioStaticConverter,
  VerovioRenderer,
  VerovioStaticRenderer,
  OpenSheetMusicDisplayRenderer,
  MmaConverter,
  FetchConverter,
  parseMusicXml,
  parseMusicXmlTimemap,
  SaxonJSProcessor,
} from './build/musicxml-player.mjs';
import {
  Playlist,
  Converter,
  Version
} from 'https://cdn.jsdelivr.net/npm/@music-i18n/ireal-musicxml@latest/+esm';

const DEFAULT_RENDERER = 'vrv';
const DEFAULT_OUTPUT = 'local';
const DEFAULT_SHEET = 'data/asa-branca.musicxml';
const DEFAULT_GROOVE = 'Default';
const DEFAULT_CONVERTER = 'vrv';
const DEFAULT_VELOCITY = 1;
const DEFAULT_REPEAT = 0;
const DEFAULT_OPTIONS = {
  unroll: false,
  horizontal: false,
  follow: true,
  mute: false,
};

const PLAYER_PLAYING = 1;

const LOCALSTORAGE_KEY = 'musicxml-player';

const g_state = {
  webmidi: null,
  player: null,
  params: null,
  musicXml: null,
  tuning: '',
  options: DEFAULT_OPTIONS,
}

async function createPlayer() {
  // Destroy previous player.
  g_state.player?.destroy();

  // Set the player parameters.
  const sheet = g_state.params.get('sheet');
  const output = g_state.params.get('output') ?? DEFAULT_OUTPUT;
  let renderer = g_state.params.get('renderer') ?? DEFAULT_RENDERER;
  const groove = g_state.params.get('groove') ?? DEFAULT_GROOVE;
  let converter = g_state.params.get('converter') ?? DEFAULT_CONVERTER;
  const velocity = g_state.params.get('velocity') ?? DEFAULT_VELOCITY;
  const repeat = g_state.params.get('repeat') ?? DEFAULT_REPEAT;
  const options = g_state.options;

  // Reset UI elements.
  const samples = document.getElementById('samples');
  samples.selectedIndex = 0;
  for (const option of samples.options) {
    if (option.value === sheet) {
      samples.value = sheet;
      break;
    }
  }
  const upload = document.getElementById('upload');
  if (!upload.value.endsWith(sheet)) {
    upload.value = '';
  }
  document.getElementById('download-musicxml').textContent = '';
  document.getElementById('download-midi').textContent = '';
  document.getElementById('error').textContent = '';
  document.getElementById('ireal').value = '';
  document.getElementById('grooves').value = groove === DEFAULT_GROOVE ? null : groove;
  document.getElementById('velocity').value = velocity;
  document.getElementById('repeat').value = repeat;

  // Detect renderer and converter possibilities based on sheet.
  const base = sheet.startsWith('http') || sheet.startsWith('data/') ? sheet : `data/${sheet}`;
  for (const [k, v] of Object.entries({
    'vrv': true,
    'osmd': true,
    'mscore': '.mscore.json',
    'vrvs': '.vrv.json',
  })) {
    const input = document.getElementById(`renderer-${k}`);
    try {
      if (typeof v === 'string') {
        await fetish(base.replace(/\.\w+$/, v), { method: 'HEAD' });
      }
      input.disabled = false;
    }
    catch {
      input.disabled = true;
      if (renderer === k) {
        renderer = DEFAULT_RENDERER;
      }
    }
  }
  document.getElementById(`renderer-${renderer}`).checked = true;
  for (const [k, v] of Object.entries({
    'vrv': true,
    'mma': async () => fetish(window.location.href + 'mma/', { method: 'HEAD' }),
    'midi': '.mid',
    'mscore': '.mscore.json',
    'vrvs': '.vrv.json',
  })) {
    const input = document.getElementById(`converter-${k}`);
    try {
      if (typeof v === 'string') {
        // For MIDI converter, also check IndexedDB cache for uploaded files
        if (k === 'midi' && !sheet.startsWith('http') && !sheet.startsWith('data/')) {
          const baseName = sheet.replace(/\.(musicxml|mxl|xml)$/i, '');
          const cached = await retrieveMidiFile(baseName);
          if (cached) {
            console.log(`✓ MIDI converter available (cached): ${baseName}`);
            input.disabled = false;
            continue;
          }
        }
        await fetish(base.replace(/\.\w+$/, v), { method: 'HEAD' });
      }
      else if (typeof v === 'function') {
        await v();
      }
      input.disabled = false;
    }
    catch {
      input.disabled = true;
      if (converter === k) {
        converter = DEFAULT_CONVERTER;
      }
    }
  }
  document.getElementById(`converter-${converter}`).checked = true;
  document.getElementById('grooves').disabled = converter !== 'mma';
  document.getElementById('tuning').disabled = converter !== 'vrv';

  // Create new player.
  if (g_state.musicXml) {
    try {
      console.log(`Creating player with converter: ${converter}, renderer: ${renderer}`);
      const converterInstance = await createConverter(converter, sheet, groove);
      console.log('Converter instance created:', converterInstance.constructor.name);
      
      const player = await Player.create({
        musicXml: g_state.musicXml,
        container: 'sheet-container',
        renderer: await createRenderer(renderer, sheet, options),
        output: createOutput(output),
        converter: converterInstance,
        unroll: options.unroll,
        mute: options.mute,
        repeat: repeat === '-1' ? Infinity : Number(repeat),
        velocity: Number(velocity),
        horizontal: options.horizontal,
        followCursor: options.follow,
        soundfontUri: 'data/GeneralUserGS.sf3',
        //timemapXslUri: 'data/timemap.sef.json',
      });

      // Update the UI elements.
      console.log(`✓ Player created successfully`);
      console.log(`  - MIDI size: ${player.midi.byteLength} bytes`);
      console.log(`  - Mute: ${options.mute}`);
      console.log(`  - Output: ${output}`);
      console.log(`  - Synthesizer:`, player._synthesizer);
      console.log(`  - Sequencer:`, player._sequencer);
      if (player._synthesizer) {
        console.log(`  - Synth voicesAmount:`, player._synthesizer.voicesAmount);
        console.log(`  - Synth channels:`, player._synthesizer.midiChannels?.length);
      }
      
      document.getElementById('version').textContent = JSON.stringify(Object.assign({}, player.version, {
        'ireal-musicxml': `${Version.name} v${Version.version}`
      }));
      const filename = player.title.toLowerCase().replace(/[/\\?%*:|"'<>\.,;\s]/g, '-') ?? 'untitled';
      const a1 = document.createElement('a');
      a1.setAttribute('href', URL.createObjectURL(new Blob([player.musicXml], { type: 'text/xml' })));
      a1.setAttribute('download', `${filename}.musicxml`);
      a1.innerText = 'Download MusicXML';
      document.getElementById('download-musicxml').appendChild(a1);
      const a2 = document.createElement('a');
      a2.setAttribute('href', URL.createObjectURL(new Blob([player.midi], { type: 'audio/midi' })));
      a2.setAttribute('download', `${filename}.mid`);
      a2.innerText = 'Download MIDI';
      document.getElementById('download-midi').appendChild(a2);
      
      console.log(`✓ Player ready - you can now click play`);

      // Save the state and player parameters.
      g_state.player = player;
      g_state.options = options;
      savePlayerOptions();
    }
    catch (error) {
      console.error('❌ Error creating player:', error);
      console.error('Error message:', error.message);
      console.error('Error stack:', error.stack);
      document.getElementById('error').textContent = `Error creating player: ${error.message}`;
    }
  }
}

async function createRenderer(renderer, sheet, options) {
  const base = sheet.startsWith('http') || sheet.startsWith('data/') ? sheet : `data/${sheet}`;
  document.querySelectorAll('.renderer-option').forEach(element => {
    element.disabled = false;
  });
  switch (renderer) {
    case 'osmd':
      return new OpenSheetMusicDisplayRenderer({
        newSystemFromXML: true,
      });
    case 'vrv':
      return new VerovioRenderer({
        fingeringScale: 0.6,
        justificationBracketGroup: 5,
        scale: 60,
      });
    case 'mscore':
      document.querySelectorAll('.renderer-option').forEach(element => {
        element.disabled = true;
      });
      return new MuseScoreRenderer(base.replace(/\.\w+$/, '.mscore.json'));
    case 'vrvs':
      document.querySelectorAll('.renderer-option').forEach(element => {
        element.disabled = true;
      });
      return new VerovioStaticRenderer([base.replace(/\.\w+$/, '.vrv.svg')], base.replace(/\.\w+$/, '.vrv.json'));
  }
}

async function createConverter(converter, sheet, groove) {
  const base = sheet.startsWith('http') || sheet.startsWith('data/') ? sheet : `data/${sheet}`;
  
  // Extract base filename for cache lookup
  let baseName = sheet.replace(/\.(musicxml|mxl|xml)$/i, '');
  if (baseName.startsWith('data/')) {
    baseName = baseName.replace(/^data\//, '');
  }
  // Check if we have a cached MIDI file for uploaded content
  // This applies to uploaded files (not starting with http or data/)
  if (!sheet.startsWith('http') && !sheet.startsWith('data/')) {
    console.log(`Checking cache for: ${baseName}, converter type: ${converter}`);
    const cached = await retrieveMidiFile(baseName);
    if (cached) {
      console.log(`✓ Using cached MIDI for: ${sheet}`);
      console.log(`  MIDI type: ${cached.midi.constructor.name}, size: ${cached.midi.byteLength} bytes`);
      console.log(`  Timemap entries: ${cached.timemap.length}`);
      console.log(`  First timemap entry:`, cached.timemap[0]);
      
      // Ensure MIDI is an ArrayBuffer
      const midiBuffer = cached.midi instanceof ArrayBuffer ? cached.midi : cached.midi.buffer;
      
      // Debug: Check first few bytes of MIDI (should start with "MThd")
      const view = new Uint8Array(midiBuffer);
      const header = String.fromCharCode(view[0], view[1], view[2], view[3]);
      console.log(`  MIDI header: "${header}" (should be "MThd")`);
      
      // For now, just use the cached MIDI without validating events
      // We'll see the issue in the player logs
      const fetchConverter = new FetchConverter(midiBuffer, cached.timemap);
      console.log('✓ Created FetchConverter with cached data');
      return fetchConverter;
    } else {
      console.log(`No cached MIDI found for: ${baseName}, will use converter: ${converter}`);
    }
  }
  
  console.log(`Creating converter type: ${converter} for sheet: ${sheet}`);
  switch (converter) {
    case 'midi':
      const midi = base.replace(/\.\w+$/, '.mid');
      try {
        const timemap = base.replace(/\.\w+$/, '.timemap.json');
        await fetish(timemap, { method: 'HEAD' });
        return new FetchConverter(midi, timemap);
      }
      catch {
        return new FetchConverter(midi);
      }
    case 'vrv':
      return new VerovioConverter({
        tuning: g_state.tuning
      });
    case 'mma':
      const parameters = {};
      if (groove !== DEFAULT_GROOVE) {
        parameters['globalGroove'] = groove;
      }
      return new MmaConverter(window.location.href + 'mma/', parameters);
    case 'mscore':
      return new MuseScoreConverter(base.replace(/\.\w+$/, '.mscore.json'));
    case 'vrvs':
      return new VerovioStaticConverter(base.replace(/\.\w+$/, '.mid'), base.replace(/\.\w+$/, '.vrv.json'))
  }
}

function createOutput(output) {
  if (g_state.webmidi) {
    return Array.from(g_state.webmidi.outputs.values()).find(o => o.id === output) ?? undefined;
  }
  return undefined;
}

function populateMidiOutputs(webmidi) {
  const outputs = document.getElementById('outputs');
  const current = outputs.value;
  outputs.textContent = '';
  [{ id: 'local', name: '(local synth)' }].concat(...(webmidi?.outputs?.values() ?? [])).forEach(output => {
    const option = document.createElement('option');
    option.value = output.id;
    option.text = output.name;
    if (option.value === current) option.selected = true;
    outputs.add(option);
  });
}

async function populateGrooves() {
  const grooves = document.getElementById('grooves');
  const groovesList = document.getElementById('grooves-list');
  try {
    const lines = await (await fetish(window.location.href + 'mma/grooves')).text();
    ['Default', 'No groove override, just whatever is specified in the score.', 'None', 'No groove, just the chords.'].concat(lines.split('\n')).forEach((line, index, lines) => {
      if (index % 2 === 1) {
        const option = document.createElement('option');
        option.value = lines[index-1].trim();
        option.text = line.trim();
        groovesList.appendChild(option);
      }
    });
    grooves.disabled = false;
  }
  catch (error) {
    grooves.disabled = true;
  }
}

function handleGrooveSelect(e) {
  if ([...document.getElementById('grooves-list').options].find(g => g.value === e.target.value)) {
    g_state.params.set('groove', e.target.value);
    g_state.params.set('converter', 'mma');
    createPlayer();
  }
}

function handleMidiOutputSelect(e) {
  g_state.params.set('output', e.target.value);
  if (g_state.player) {
    g_state.player.output = createOutput(e.target.value);
  }
  savePlayerOptions();
}

function handleRendererChange(e) {
  g_state.params.set('renderer', e.target.value);
  createPlayer();
}

function handleConverterChange(e) {
  g_state.params.set('converter', e.target.value);
  createPlayer();
}

function handlePlayPauseKey(e) {
  if (e.key === ' ' && g_state.player) {
    e.preventDefault();
    if (g_state.player.state === PLAYER_PLAYING) {
      g_state.player.pause();
    }
    else {
      g_state.player.play();
    }
  }
}

function populateSheets(ireal) {
  const playlist = new Playlist(ireal);
  const sheets = document.getElementById('sheets');
  sheets.textContent = '';
  playlist.songs.forEach(song => {
    const option = document.createElement('option');
    option.value = JSON.stringify(song);
    option.text = song.title;
    sheets.add(option);
  });
  sheets.dispatchEvent(new Event('change'));
}

async function handleSampleSelect(e) {
  if (!e.target.value) return;
  let sheet = e.target.value;
  let option = document.querySelector(`#samples option[value="${sheet}"]`);
  if (!option) {
    sheet = DEFAULT_SHEET;
    option = document.querySelector(`#samples option[value="${sheet}"]`);
  }
  document.getElementById('sheets').textContent = '';
  try {
    g_state.params.set('renderer', option.getAttribute('data-renderer'));
    g_state.params.set('converter', option.getAttribute('data-converter'));
    if (sheet.endsWith('.musicxml') || sheet.endsWith('.mxl')) {
      const musicXml = await (await fetish(sheet)).arrayBuffer();
      g_state.musicXml = musicXml;
      g_state.params.set('sheet', sheet);
      g_state.params.set('groove', DEFAULT_GROOVE);
      createPlayer();
    }
    else {
      const ireal = await (await fetish(sheet)).text();
      g_state.params.set('sheet', sheet);
      g_state.params.set('groove', DEFAULT_GROOVE);
      populateSheets(ireal);
    }
  }
  catch (error) {
    console.error(error);
  }
}

function handleSheetSelect(e) {
  const song = JSON.parse(e.target.value);
  g_state.musicXml = Converter.convert(song, {
    notation: 'rhythmic',
    date: false,
  });
  g_state.params.set('groove', DEFAULT_GROOVE);
  createPlayer();
}

async function handleFileBuffer(filename, buffer, skipCacheDelete = false) {
  try {
    const parseResult = await parseMusicXml(buffer, new SaxonJSProcessor());
    g_state.musicXml = parseResult.musicXml;
    g_state.params.set('sheet', filename);
    
    const baseName = filename.replace(/\.(musicxml|mxl|xml)$/i, '');
    
    // Only delete cache and generate MIDI if user didn't provide MIDI file
    if (!skipCacheDelete) {
      await deleteMidiFile(baseName);
      await ensureMidiFile(filename, parseResult.musicXml);
    }
    
    // Set converter to 'vrv' for uploaded files to generate MIDI on the fly
    g_state.params.set('converter', 'vrv');
    
    createPlayer();
  }
  catch (error) {
    console.error('Error processing uploaded file:', error);
    try {
      const ireal = new TextDecoder().decode(buffer);
      populateSheets(ireal);
    }
    catch (error2) {
      document.getElementById('error').textContent = 'This file is not recognized as either MusicXML or iReal Pro.';
    }
  }
}

/**
 * Ensure MIDI file exists for the given MusicXML file.
 * If not found in data directory, generate it using Verovio.
 * @param {string} filename - Original MusicXML filename
 * @param {string} musicXml - MusicXML content
 */
async function ensureMidiFile(filename, musicXml) {
  const baseName = filename.replace(/\.(musicxml|mxl|xml)$/i, '');
  const midiPath = `data/${baseName}.mid`;
  
  try {
    // Try to fetch existing MIDI file
    await fetish(midiPath, { method: 'HEAD' });
    return;
  } catch (error) {
    // MIDI file doesn't exist, generate it
    try {
      // Use Verovio to generate MIDI and timemap
      const converter = new VerovioConverter({
        tuning: g_state.tuning
      });
      
      await converter.initialize(musicXml, {
        container: document.createElement('div'),
        musicXml: musicXml,
        renderer: {},
        converter: {},
        output: null,
        soundfontUri: '',
        unrollXslUri: 'https://raw.githubusercontent.com/infojunkie/musicxml-midi/main/build/unroll.sef.json',
        timemapXslUri: 'https://raw.githubusercontent.com/infojunkie/musicxml-midi/main/build/timemap.sef.json',
        unroll: false,
        mute: false,
        repeat: 1,
        velocity: 1,
        horizontal: false,
        followCursor: true,
        xsltProcessor: new SaxonJSProcessor(),
      });
      
      // Store generated MIDI in IndexedDB for persistence
      await storeMidiFile(baseName, converter.midi, converter.timemap);
    } catch (generationError) {
      console.error('Failed to generate MIDI:', generationError);
      // Don't throw - player will fall back to runtime conversion
    }
  }
}

/**
 * Store generated MIDI file and timemap in IndexedDB for future use
 * @param {string} baseName - Base filename without extension
 * @param {ArrayBuffer} midiData - MIDI file data
 * @param {Array} timemap - Timemap data
 */
async function storeMidiFile(baseName, midiData, timemap) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('MusicXMLPlayerCache', 1);
    
    request.onerror = () => reject(request.error);
    
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('midiFiles')) {
        db.createObjectStore('midiFiles', { keyPath: 'name' });
      }
    };
    
    request.onsuccess = (event) => {
      const db = event.target.result;
      const transaction = db.transaction(['midiFiles'], 'readwrite');
      const store = transaction.objectStore('midiFiles');
      
      store.put({
        name: baseName,
        midi: midiData,
        timemap: timemap,
        timestamp: Date.now()
      });
      
      transaction.oncomplete = () => {
        db.close();
        resolve();
      };
      
      transaction.onerror = (err) => {
        console.error(`Failed to store MIDI data:`, err);
        db.close();
        reject(transaction.error);
      };
    };
  });
}

/**
 * Delete stored MIDI file from IndexedDB
 * @param {string} baseName - Base filename without extension
 */
async function deleteMidiFile(baseName) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('MusicXMLPlayerCache', 1);
    
    request.onerror = () => reject(request.error);
    
    request.onsuccess = (event) => {
      const db = event.target.result;
      const transaction = db.transaction(['midiFiles'], 'readwrite');
      const store = transaction.objectStore('midiFiles');
      
      store.delete(baseName);
      
      transaction.oncomplete = () => {
        db.close();
        resolve();
      };
      
      transaction.onerror = (err) => {
        console.error(`Failed to delete MIDI data:`, err);
        db.close();
        reject(transaction.error);
      };
    };
  });
}

/**
 * Retrieve stored MIDI file from IndexedDB
 * @param {string} baseName - Base filename without extension
 * @returns {Promise<{midi: ArrayBuffer, timemap: Array}|null>}
 */
async function retrieveMidiFile(baseName) {
  return new Promise((resolve) => {
    const request = indexedDB.open('MusicXMLPlayerCache', 1);
    
    request.onerror = () => resolve(null);
    
    request.onsuccess = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('midiFiles')) {
        db.close();
        resolve(null);
        return;
      }
      
      const transaction = db.transaction(['midiFiles'], 'readonly');
      const store = transaction.objectStore('midiFiles');
      const getRequest = store.get(baseName);
      
      getRequest.onsuccess = () => {
        const result = getRequest.result;
        if (result) {
          console.log(`Retrieved cached MIDI for: ${baseName}`);
          console.log(`  MIDI size: ${result.midi.byteLength} bytes`);
          console.log(`  Timemap entries: ${result.timemap.length}`);
        }
        db.close();
        resolve(result || null);
      };
      
      getRequest.onerror = () => {
        db.close();
        resolve(null);
      };
    };
  });
}
async function handleFileUpload(e) {
  const files = Array.from(e.target.files);
  
  // Check if user uploaded both MusicXML and MIDI
  const musicXmlFile = files.find(f => f.name.match(/\.(musicxml|mxl|xml)$/i));
  const midiFile = files.find(f => f.name.match(/\.mid$/i));
  
  if (!musicXmlFile) {
    document.getElementById('error').textContent = 'Please upload a MusicXML file (.musicxml, .mxl, or .xml)';
    return;
  }
  
  if (musicXmlFile.size > 1*1024*1024) {
    document.getElementById('error').textContent = 'MusicXML file is too large (max 1MB).';
    return;
  }
  
  // If MIDI file provided, store it in cache before processing MusicXML
  if (midiFile) {
    if (midiFile.size > 1*1024*1024) {
      document.getElementById('error').textContent = 'MIDI file is too large (max 1MB).';
      return;
    }
    
    const baseName = musicXmlFile.name.replace(/\.(musicxml|mxl|xml)$/i, '');
    
    // Read MIDI file and store in cache
    const midiReader = new FileReader();
    await new Promise((resolve) => {
      midiReader.onloadend = async (upload) => {
        const midiBuffer = upload.target.result;
        
        // Parse MusicXML to get timemap
        const xmlReader = new FileReader();
        xmlReader.onloadend = async (xmlUpload) => {
          try {
            const parseResult = await parseMusicXml(xmlUpload.target.result, new SaxonJSProcessor());
            const timemap = await parseMusicXmlTimemap(
              parseResult.musicXml,
              'https://raw.githubusercontent.com/infojunkie/musicxml-midi/main/build/timemap.sef.json',
              new SaxonJSProcessor()
            );
            
            // Store user-provided MIDI in cache
            await storeMidiFile(baseName, midiBuffer, timemap);
            
            // Now process the MusicXML file (skip cache deletion since we just stored user MIDI)
            await handleFileBuffer(musicXmlFile.name, xmlUpload.target.result, true);
            resolve();
          } catch (error) {
            console.error('Error processing files:', error);
            document.getElementById('error').textContent = 'Error processing uploaded files.';
            resolve();
          }
        };
        xmlReader.readAsArrayBuffer(musicXmlFile);
      };
      midiReader.readAsArrayBuffer(midiFile);
    });
  } else {
    // Only MusicXML provided - try to generate MIDI (may not work for percussion)
    const reader = new FileReader();
    reader.onloadend = async (upload) => {
      await handleFileBuffer(musicXmlFile.name, upload.target.result);
    };
    reader.readAsArrayBuffer(musicXmlFile);
  }
}

function handleIRealChange(e) {
  if (!e.target.value) return;
  try {
    populateSheets(e.target.value);
  }
  catch {
    document.getElementById('error').textContent = 'This URI is not recognized as iReal Pro.';
    document.getElementById('ireal').value = '';
  }
}

function handleOptionChange(e) {
  g_state.options = {
    unroll: !!document.getElementById('option-unroll').checked,
    horizontal: !!document.getElementById('option-horizontal').checked,
    mute: !!document.getElementById('option-mute').checked,
    follow: !!document.getElementById('option-follow').checked,
  };
  if (e.target.id === 'option-mute') {
    if (g_state.player) {
      g_state.player.mute = g_state.options.mute;
    }
    savePlayerOptions();
  }
  else {
    createPlayer();
  }
}

function handleVelocityChange(e) {
  g_state.params.set('velocity', e.target.value);
  if (g_state.player) {
    g_state.player.velocity = Number(e.target.value);
  }
  savePlayerOptions();
}

function handleRepeatChange(e) {
  g_state.params.set('repeat', e.target.value);
  if (g_state.player) {
    g_state.player.repeat = e.target.value === '-1' ? Infinity : Number(e.target.value);
  }
  savePlayerOptions();
}

async function handleTuningText(filename, tuning) {
  g_state.tuning = tuning;
  createPlayer();
}

async function handleTuningUpload(e) {
  const reader = new FileReader();
  const file = e.target.files[0];
  reader.onloadend = async (upload) => {
    await handleTuningText(file.name, upload.target.result);
  };
  if (file.size < 100*1024) {
    reader.readAsText(file);
  }
  else {
    document.getElementById('error').textContent = 'Tuning file is too large.';
  }
}

function savePlayerOptions() {
  try {
    window.localStorage.setItem(LOCALSTORAGE_KEY, JSON.stringify({
      params: [...g_state.params.entries()],
      options: g_state.options,
    }));
  }
  catch (error) {
    console.warn(`Error saving player state: ${error}`);
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  // Load the parameters from local storage and/or the URL.
  const params = new URLSearchParams(document.location.search);
  try {
    const stored = JSON.parse(window.localStorage.getItem(LOCALSTORAGE_KEY));
    g_state.params = new URLSearchParams([...stored.params]);
    params.entries().forEach(([key, value]) => { g_state.params.set(key, value); });
    g_state.options = stored.options;
  }
  catch {
    g_state.params = params;
  }
  g_state.params.set('output', DEFAULT_OUTPUT); // Too complicated to wait for MIDI output
  window.g_state = g_state;

  // Build the UI.
  await populateGrooves();

  document.querySelectorAll('input[name="converter"]').forEach(input => {
    input.addEventListener('change', handleConverterChange);
    if (input.value === (g_state.params.get('converter') ?? DEFAULT_CONVERTER)) {
      input.checked = true;
    }
  });
  document.querySelectorAll('input[name="renderer"]').forEach(input => {
    input.addEventListener('change', handleRendererChange);
    if (input.value === (g_state.params.get('renderer') ?? DEFAULT_RENDERER)) {
      input.checked = true;
    }
  });
  document.getElementById('play').addEventListener('click', async () => {
    console.log('Play button clicked');
    if (g_state.player) {
      try {
        console.log('Play button clicked');
        console.log('Player state before play:', {
          duration: g_state.player.duration,
          state: g_state.player.state,
          position: g_state.player.position,
          muted: g_state.player.muted
        });
        
        // Check AudioContext state
        if (g_state.player._context) {
          console.log('AudioContext state:', g_state.player._context.state);
        }
        
        // Check sequencer state
        if (g_state.player._sequencer) {
          console.log('Sequencer paused:', g_state.player._sequencer.paused);
          console.log('Sequencer currentTime:', g_state.player._sequencer.currentTime);
        }
        
        // Check synthesizer
        if (g_state.player._synthesizer) {
          console.log('Synth voicesAmount:', g_state.player._synthesizer.voicesAmount);
          console.log('Synth system:', g_state.player._synthesizer.system);
        }
        
        // Check if sequencer is still loading
        if (g_state.player._sequencer.isLoading) {
          console.log('⚠ Sequencer is still loading, waiting...');
          // Wait for it to finish loading
          const checkLoading = setInterval(() => {
            if (!g_state.player._sequencer.isLoading) {
              clearInterval(checkLoading);
              console.log('✓ Sequencer finished loading, midiData:', g_state.player._sequencer.midiData);
              g_state.player.play();
            }
          }, 100);
          return;
        }
        
        g_state.player.play();
        
        // Wait a bit and check state
        setTimeout(() => {
          console.log('Player state after play:', {
            state: g_state.player.state,
            position: g_state.player.position
          });
          if (g_state.player._context) {
            console.log('AudioContext state after play:', g_state.player._context.state);
          }
          if (g_state.player._sequencer) {
            console.log('Sequencer after play:', {
              paused: g_state.player._sequencer.paused,
              currentTime: g_state.player._sequencer.currentTime,
              midiData: g_state.player._sequencer.midiData,
              songListData: g_state.player._sequencer.songListData
            });
          }
          if (g_state.player._synthesizer) {
            console.log('Synth after play:', {
              voicesAmount: g_state.player._synthesizer.voicesAmount,
              channelsAmount: g_state.player._synthesizer.channelsAmount
            });
            
            // Check channel states
            for (let i = 0; i < 16; i++) {
              const channel = g_state.player._synthesizer.midiChannels?.[i];
              if (channel) {
                console.log(`Channel ${i}:`, {
                  preset: channel.preset,
                  voices: channel.voices?.length || 0
                });
              }
            }
          }
          
          // Check if there are any MIDI events
          if (g_state.player._sequencer.midiData) {
            const midiData = g_state.player._sequencer.midiData;
            console.log('MIDI data info:', {
              tracks: midiData.tracks?.length,
              duration: midiData.duration,
              timeDivision: midiData.timeDivision
            });
            
            // Check each track for events
            if (midiData.tracks) {
              midiData.tracks.forEach((track, i) => {
                console.log(`Track ${i}:`, track);
                if (Array.isArray(track)) {
                  console.log(`  - Events: ${track.length}`);
                  if (track.length > 0) {
                    console.log(`  - First event:`, track[0]);
                  }
                }
              });
            }
          }
        }, 100);
        
        console.log('✓ player.play() called');
      } catch (error) {
        console.error('❌ Error calling player.play():', error);
        console.error('Error stack:', error.stack);
      }
    } else {
      console.error('❌ No player instance available');
    }
  });
  document.getElementById('pause').addEventListener('click', async () => {
    console.log('Pause button clicked');
    g_state.player?.pause();
  });
  document.getElementById('rewind').addEventListener('click', async () => {
    console.log('Rewind button clicked');
    g_state.player?.rewind();
  });
  document.getElementById('upload').addEventListener('change', handleFileUpload);
  document.getElementById('samples').addEventListener('change', handleSampleSelect);
  document.getElementById('sheets').addEventListener('change', handleSheetSelect);
  document.getElementById('grooves').addEventListener('change', handleGrooveSelect);
  document.getElementById('outputs').addEventListener('change', handleMidiOutputSelect);
  document.getElementById('ireal').addEventListener('change', handleIRealChange);
  document.getElementById('velocity').addEventListener('change', handleVelocityChange);
  document.getElementById('repeat').addEventListener('change', handleRepeatChange);
  document.getElementById('tuning').addEventListener('change', handleTuningUpload);
  document.querySelectorAll('.option').forEach(element => {
    if (!!g_state.options[element.id.replace('option-', '')]) {
      element.checked = true;
    }
    element.addEventListener('change', handleOptionChange);
  });
  window.addEventListener('keydown', handlePlayPauseKey);

  // Initialize Web MIDI.
  if (navigator.requestMIDIAccess) navigator.requestMIDIAccess({
    sysex: true
  }).then(webmidi => {
    populateMidiOutputs(webmidi);
    webmidi.onstatechange = () => populateMidiOutputs(webmidi);
    g_state.webmidi = webmidi;
  }, error => {
    console.error(error);
    populateMidiOutputs();
  });

  // Start the app.
  await handleSampleSelect({ target: { value: g_state.params.get('sheet') ?? DEFAULT_SHEET }});
});
