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
  convertUnpitchedToPitched,
} from './build/musicxml-player.mjs';
import {
  Playlist,
  Converter,
  Version
} from 'https://cdn.jsdelivr.net/npm/@music-i18n/ireal-musicxml@latest/+esm';

const DEFAULT_RENDERER = 'osmd';
const DEFAULT_OUTPUT = 'local';
const DEFAULT_SHEET = 'data/asa-branca.musicxml';
const DEFAULT_GROOVE = 'Default';
const DEFAULT_CONVERTER = 'vrv';
const DEFAULT_VELOCITY = 1;
const DEFAULT_REPEAT = 0;

// List of CORS proxies to try in order
const CORS_PROXIES = [
  '/proxy?url=',  // Our own backend proxy (most reliable)
  'https://corsproxy.io/?',
  'https://api.allorigins.win/raw?url=',
];

/**
 * Fetch a file from an external URL using the backend proxy.
 * The proxy handles URL conversion (Google Drive, Dropbox, etc.) and domain validation.
 */
async function fetchExternalUrl(url) {
  console.log('[fetchExternalUrl] Starting fetch for:', url);
  
  // All external URLs go through the proxy to ensure proper handling
  // The server will:
  // 1. Validate the domain is allowed
  // 2. Convert cloud storage URLs (Google Drive, Dropbox, OneDrive)
  // 3. Fetch the file without CORS restrictions
  // 4. Return the actual file content
  
  // Try each proxy in order (our own backend proxy first)
  for (const proxy of CORS_PROXIES) {
    try {
      const proxyUrl = proxy + encodeURIComponent(url);
      console.log('[fetchExternalUrl] Trying proxy:', proxyUrl);
      const response = await fetish(proxyUrl);
      if (response.ok) {
        console.log('[fetchExternalUrl] Success! Response size:', response.headers.get('content-length'));
        return await response.arrayBuffer();
      }
    } catch (error) {
      console.log('[fetchExternalUrl] Proxy failed:', proxy, error.message);
      // This proxy failed, try the next one
      continue;
    }
  }
  
  // All proxies failed
  throw new Error(`Unable to fetch ${url}. All CORS proxies failed.`);
}
const DEFAULT_OPTIONS = {
  unroll: false,
  horizontal: false,
  follow: true,
  mute: false,
  respectLineBreaks: false,
};

const PLAYER_PLAYING = 1;

const LOCALSTORAGE_KEY = 'musicxml-player';
const PLAYLISTS_KEY = 'musicxml-player-playlists';

const g_state = {
  webmidi: null,
  player: null,
  params: null,
  musicXml: null,
  tuning: '',
  options: DEFAULT_OPTIONS,
  // Playlist state
  currentPlaylistId: null,
  currentSongIndex: -1,
  currentPlaylist: null,
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
  // Only clear ireal if the sheet is not a URL
  if (!sheet.startsWith('http')) {
    document.getElementById('ireal').value = '';
  }
  document.getElementById('velocity').value = velocity;
  document.getElementById('repeat').value = repeat;

  // Detect renderer and converter possibilities based on sheet.
  const base = sheet.startsWith('http') || sheet.startsWith('data/') ? sheet : `data/${sheet}`;
  const isExternalUrl = sheet.startsWith('http');
  
  for (const [k, v] of Object.entries({
    'vrv': true,
    'osmd': true,
  })) {
    const input = document.getElementById(`renderer-${k}`);
    
    // Skip HEAD requests for external URLs, just enable both renderers
    if (isExternalUrl) {
      input.disabled = false;
      continue;
    }
    
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
  
  // Auto-detect converter: prefer custom MIDI if available, otherwise use Verovio
  let detectedConverter = 'vrv'; // Default to Verovio
  
  // Check if custom MIDI file exists in data directory (skip for external URLs)
  const baseName = base.replace(/\.(musicxml|mxl|xml)$/i, '').replace(/^data\//, '');
  if (baseName !== 'remote-file') {
    try {
      const midiPath = base.replace(/\.\w+$/, '.mid');
      await fetish(midiPath, { method: 'HEAD' });
      detectedConverter = 'midi';
      console.log(`✓ Custom MIDI file found: ${midiPath}`);
      console.log(`  Will use MIDI converter (pre-existing MIDI, not generated)`);
    }
    catch {
      // Check IndexedDB cache for uploaded MIDI files
      if (!sheet.startsWith('http') && !sheet.startsWith('data/')) {
        const cached = await retrieveMidiFile(baseName);
        if (cached) {
          detectedConverter = 'midi';
          console.log(`✓ MIDI converter available (cached): ${baseName}`);
        }
      }
    }
  } else {
    // For external URLs, check IndexedDB cache only
    const cached = await retrieveMidiFile(baseName);
    if (cached) {
      detectedConverter = 'midi';
      console.log(`✓ MIDI converter available (cached): ${baseName}`);
    }
  }
  
  // Override converter parameter with auto-detected value
  converter = detectedConverter;
  console.log(`Using converter: ${converter}`);

  // Create new player.
  if (g_state.musicXml) {
    try {
      console.log(`Creating player with converter: ${converter}, renderer: ${renderer}`);
      const converterInstance = await createConverter(converter, sheet, groove, renderer);
      console.log('Converter instance created:', converterInstance.constructor.name);
      
      const player = await Player.create({
        musicXml: g_state.musicXml,
        container: 'sheet-container',
        renderer: await createRenderer(renderer, sheet, options),
        output: undefined, // Always use local synth
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
      console.log(`  - followCursor option:`, options.follow);
      console.log(`  - MIDI size: ${player.midi.byteLength} bytes`);
      console.log(`  - Mute: ${options.mute}`);
      console.log(`  - Output: ${output}`);
      console.log(`  - Renderer:`, renderer, player._options.renderer.constructor.name);
      console.log(`  - Converter:`, converter, player._options.converter.constructor.name);
      console.log(`  - Timemap entries:`, player._options.converter.timemap.length);
      console.log(`  - First 3 timemap entries:`, player._options.converter.timemap.slice(0, 3));
      console.log(`  - Synthesizer:`, player._synthesizer);
      console.log(`  - Sequencer:`, player._sequencer);
      if (player._synthesizer) {
        console.log(`  - Synth voicesAmount:`, player._synthesizer.voicesAmount);
        console.log(`  - Synth channels:`, player._synthesizer.midiChannels?.length);
      }
      
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
      
      // Set up auto-advance monitoring for playlists
      setupPlaylistAutoAdvance();
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
        newSystemFromXML: options.respectLineBreaks ?? false,
      }, {
        MinMeasureToDrawIndex: 0,
        MaxMeasureToDrawIndex: Number.MAX_SAFE_INTEGER,
        FillEmptyMeasuresWithWholeRests: true,
        MinimumDistanceBetweenSystems: 7,
        SystemLeftMargin: 0,
        SystemRightMargin: 0,
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

async function createConverter(converter, sheet, groove, renderer) {
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
      if (cached.timemap) {
        console.log(`  Timemap entries: ${cached.timemap.length}`);
        console.log(`  First timemap entry:`, cached.timemap[0]);
      } else {
        console.log(`  No timemap (timing will be calculated from score)`);
      }
      
      // Ensure MIDI is an ArrayBuffer
      const midiBuffer = cached.midi instanceof ArrayBuffer ? cached.midi : cached.midi.buffer;
      
      // Debug: Check first few bytes of MIDI (should start with "MThd")
      const view = new Uint8Array(midiBuffer);
      const header = String.fromCharCode(view[0], view[1], view[2], view[3]);
      console.log(`  MIDI header: "${header}" (should be "MThd")`);
      
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
      console.log(`📁 Loading pre-existing MIDI file: ${midi}`);
      try {
        const timemap = base.replace(/\.\w+$/, '.timemap.json');
        await fetish(timemap, { method: 'HEAD' });
        console.log(`📁 Loading timemap file: ${timemap}`);
        console.log(`✓ Using pre-existing MIDI + timemap (not generating)`);
        return new FetchConverter(midi, timemap);
      }
      catch {
        console.log(`⚠️ No timemap file found for ${midi}`);
        console.log(`  Timemap will be generated from MusicXML`);
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

async function handleSampleSelect(e) {
  if (!e.target.value) return;
  
  // Clear playlist state when manually selecting a sample
  clearPlaylistState();
  
  let sheet = e.target.value;
  let option = document.querySelector(`#samples option[value="${sheet}"]`);
  if (!option) {
    sheet = DEFAULT_SHEET;
    option = document.querySelector(`#samples option[value="${sheet}"]`);
  }
  
  // Clear playlist state when manually selecting a sample
  clearPlaylistState();
  
  try {
    g_state.params.set('renderer', option.getAttribute('data-renderer'));
    g_state.params.set('converter', option.getAttribute('data-converter'));
    if (sheet.endsWith('.musicxml') || sheet.endsWith('.mxl')) {
      // Fetch the MusicXML file
      const buffer = await (await fetish(sheet)).arrayBuffer();
      
      // Extract filename from path
      const filename = sheet.split('/').pop();
      
      // Use handleFileBuffer which will parse, convert unpitched percussion, and ensure MIDI exists
      await handleFileBuffer(filename, buffer);
    }
    else {
      // For iReal Pro files, just load the first song
      const ireal = await (await fetish(sheet)).text();
      const playlist = new Playlist(ireal);
      if (playlist.songs.length > 0) {
        const song = playlist.songs[0];
        g_state.musicXml = Converter.convert(song, {
          notation: 'rhythmic',
          date: false,
        });
        g_state.params.set('sheet', sheet);
        g_state.params.set('groove', DEFAULT_GROOVE);
        createPlayer();
      }
    }
  }
  catch (error) {
    console.error(error);
  }
}

async function handleIRealChange(e) {
  let url = e.target.value.trim();
  if (!url) return;
  
  // Clear playlist state when manually entering a URL
  clearPlaylistState();
  
  try {
    // Fetch the file using the generic helper (handles CORS automatically)
    const buffer = await fetchExternalUrl(url);
    
    console.log('[handleIRealChange] Received buffer, size:', buffer.byteLength);
    console.log('[handleIRealChange] First 50 bytes:', new Uint8Array(buffer.slice(0, 50)));
    
    // Extract filename for display and caching
    // For Google Drive/Dropbox/OneDrive URLs, use a generic name
    let filename;
    if (url.includes('drive.google.com') || url.includes('dropbox.com') || url.includes('onedrive.live.com')) {
      // Determine file extension from buffer content
      const first4Bytes = new Uint8Array(buffer.slice(0, 4));
      const isPK = first4Bytes[0] === 0x50 && first4Bytes[1] === 0x4B; // PK (ZIP/MXL)
      filename = isPK ? 'remote-file.mxl' : 'remote-file.musicxml';
    } else {
      filename = url.split('/').pop().split('?')[0] || 'remote-file.musicxml';
    }
    
    console.log('[handleIRealChange] Using filename:', filename);
    
    // Store the original URL before calling handleFileBuffer
    const originalUrl = e.target.value;
    
    // Use the same handling as file uploads (includes unpitched conversion and proper unrolling)
    await handleFileBuffer(filename, buffer);
    
    // Override the sheet parameter with the original URL so it persists
    g_state.params.set('sheet', originalUrl);
    
    // Keep the URL visible in the input field
    document.getElementById('ireal').value = originalUrl;
    
    // Clear any error messages
    document.getElementById('error').textContent = '';
  } catch (error) {
    console.error('Error loading MusicXML from URL:', error);
    document.getElementById('error').textContent = `Failed to load MusicXML from URL. Make sure the URL is accessible and the file is a valid MusicXML file. (${error.message})`;
  }
}

async function handleFileBuffer(filename, buffer, skipCacheDelete = false) {
  try {
    console.log('[handleFileBuffer] Starting to parse MusicXML, filename:', filename);
    const parseResult = await parseMusicXml(buffer, new SaxonJSProcessor());
    console.log('[handleFileBuffer] Successfully parsed MusicXML');
    g_state.musicXml = parseResult.musicXml;
    g_state.params.set('sheet', filename);
    
    const baseName = filename.replace(/\.(musicxml|mxl|xml)$/i, '');
    
    // Only delete cache and generate MIDI if user didn't provide MIDI file
    if (!skipCacheDelete) {
      await deleteMidiFile(baseName);
      await ensureMidiFile(filename, parseResult.musicXml);
    }
    
    // For URL-loaded files, try using MuseScore converter which works better with OSMD renderer
    // MuseScore's timemap has better alignment with OSMD's cursor tracking
    const isUrl = filename.startsWith('http');
    g_state.params.set('converter', isUrl ? 'ms' : 'vrv');
    
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
 * First tries to load from data directory, then generates using Verovio if not found.
 * @param {string} filename - Original MusicXML filename
 * @param {string} musicXml - MusicXML content
 */
async function ensureMidiFile(filename, musicXml) {
  const baseName = filename.replace(/\.(musicxml|mxl|xml)$/i, '');
  
  // Skip checking for MIDI file if this is an external URL (remote-file)
  // We know it won't exist on the server
  if (baseName !== 'remote-file') {
    const midiPath = `data/${baseName}.mid`;
    
    // Try to fetch existing MIDI file from data directory (suppress 404 errors)
    const midiResponse = await fetch(midiPath);
    if (midiResponse.ok) {
      // Found existing MIDI file, use it
      const midiBuffer = await midiResponse.arrayBuffer();
      
      // Generate timemap from MusicXML
      const timemap = await parseMusicXmlTimemap(
        musicXml,
        'https://raw.githubusercontent.com/infojunkie/musicxml-midi/main/build/timemap.sef.json',
        new SaxonJSProcessor()
      );
      
      // Store MIDI from data directory in cache for future use
      await storeMidiFile(baseName, midiBuffer, timemap);
      return;
    }
  }
  
  // MIDI file doesn't exist in data directory, generate it
  try {
    // Convert unpitched percussion to pitched notes before Verovio processing
    // This allows Verovio to generate proper MIDI with Note On/Off events
    const processedMusicXml = convertUnpitchedToPitched(musicXml);
      
      // Use Verovio to generate MIDI and timemap
      const converter = new VerovioConverter({
        tuning: g_state.tuning
      });
      
      await converter.initialize(processedMusicXml, {
        container: document.createElement('div'),
        musicXml: processedMusicXml,
        renderer: {},
        converter: {},
        output: null,
        soundfontUri: '',
        unrollXslUri: 'https://raw.githubusercontent.com/infojunkie/musicxml-midi/main/build/unroll.sef.json',
        timemapXslUri: 'https://raw.githubusercontent.com/infojunkie/musicxml-midi/main/build/timemap.sef.json',
        unroll: true,
        mute: false,
        repeat: 1,
        velocity: 1,
        horizontal: false,
        followCursor: true,
        xsltProcessor: new SaxonJSProcessor(),
      });
      
      // Generate timemap from ORIGINAL MusicXML (not converted) for accurate measure timing
      const timemap = await parseMusicXmlTimemap(
        musicXml,
        'https://raw.githubusercontent.com/infojunkie/musicxml-midi/main/build/timemap.sef.json',
        new SaxonJSProcessor()
      );
      
      // Store generated MIDI with timemap
      await storeMidiFile(baseName, converter.midi, timemap);
  } catch (generationError) {
    console.error('Failed to generate MIDI:', generationError);
    // Don't throw - player will fall back to runtime conversion
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
    
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('midiFiles')) {
        db.createObjectStore('midiFiles', { keyPath: 'name' });
      }
    };
    
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
          if (result.timemap) {
            console.log(`  Timemap entries: ${result.timemap.length}`);
          } else {
            console.log(`  No timemap (will calculate timing from score)`);
          }
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
  
  // Clear playlist state when uploading files
  clearPlaylistState();
  
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

function handleOptionChange(e) {
  g_state.options = {
    unroll: false, // Always unchecked
    horizontal: false, // Always unchecked
    mute: !!document.getElementById('option-mute').checked,
    follow: true, // Always checked
    respectLineBreaks: !!document.getElementById('respect-line-breaks').checked,
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

async function populateSamplesList() {
  const samplesSelect = document.getElementById('samples');
  samplesSelect.innerHTML = '<option value="">-- Choose --</option>';
  
  try {
    // List of all MusicXML files in the data directory
    const musicFiles = [
      '98.mxl',
      'asa-branca.musicxml',
      'baiao-miranda.musicxml',
      'blackwood-ex-29.musicxml',
      'blue-bag-folly.musicxml',
      'chopin-trois-valses.mxl',
      'maqam-rast.musicxml',
      'neville-san.musicxml',
      'page16.mxl',
      'page17.mxl',
      'page22new.musicxml',
      'sagittal.musicxml',
      'salma-ya-salama.mxl',
      'shumays.musicxml',
      'tutorial-apres-un-reve.musicxml',
    ];

    // Check which files exist and add them to the dropdown
    for (const file of musicFiles) {
      try {
        await fetish(`data/${file}`, { method: 'HEAD' });
        // Create a display name from the filename
        const displayName = file
          .replace(/\.(musicxml|mxl)$/i, '')
          .replace(/[-_]/g, ' ')
          .replace(/\b\w/g, l => l.toUpperCase());
        
        const option = document.createElement('option');
        option.value = `data/${file}`;
        option.text = displayName;
        option.setAttribute('data-renderer', 'osmd');
        option.setAttribute('data-converter', 'midi');
        samplesSelect.add(option);
      } catch (error) {
        // File doesn't exist, skip it
        console.log(`File not found: data/${file}`);
      }
    }
  } catch (error) {
    console.error('Error populating samples list:', error);
  }
}

// ========== Playlist Management Functions ==========

let currentEditingPlaylistId = null;

// Load a song from URL (for playlist playback)
async function loadSongFromUrl(url) {
  try {
    // Fetch the file using the generic helper (handles CORS automatically)
    const buffer = await fetchExternalUrl(url);
    
    console.log('[loadSongFromUrl] Received buffer, size:', buffer.byteLength);
    console.log('[loadSongFromUrl] First 50 bytes:', new Uint8Array(buffer.slice(0, 50)));
    
    // Extract filename for display and caching
    // For Google Drive/Dropbox/OneDrive URLs, use a generic name
    let filename;
    if (url.includes('drive.google.com') || url.includes('dropbox.com') || url.includes('onedrive.live.com')) {
      // Determine file extension from buffer content
      const first4Bytes = new Uint8Array(buffer.slice(0, 4));
      const isPK = first4Bytes[0] === 0x50 && first4Bytes[1] === 0x4B; // PK (ZIP/MXL)
      filename = isPK ? 'remote-file.mxl' : 'remote-file.musicxml';
    } else {
      filename = url.split('/').pop().split('?')[0] || 'remote-file.musicxml';
    }
    
    console.log('[loadSongFromUrl] Using filename:', filename);
    
    // Use the same handling as file uploads
    await handleFileBuffer(filename, buffer);
    
    // Override the sheet parameter with the original URL
    g_state.params.set('sheet', url);
    
    // Update the URL input field
    document.getElementById('ireal').value = url;
    
    // Clear any error messages
    document.getElementById('error').textContent = '';
    
    return true;
  } catch (error) {
    console.error('Error loading song from URL:', error);
    const errorMsg = error.message || 'Unknown error';
    document.getElementById('error').textContent = `Failed to load song: ${errorMsg}`;
    return false;
  }
}

// Update playlist display in UI
function updatePlaylistDisplay() {
  const playlistInfo = document.getElementById('playlist-info');
  const prevBtn = document.getElementById('prev');
  const nextBtn = document.getElementById('next');
  
  if (g_state.currentPlaylist && g_state.currentSongIndex >= 0) {
    // Show playlist info
    const songNum = g_state.currentSongIndex + 1;
    const totalSongs = g_state.currentPlaylist.urls.length;
    const currentUrl = g_state.currentPlaylist.urls[g_state.currentSongIndex];
    const songName = currentUrl.split('/').pop().split('?')[0];
    
    playlistInfo.textContent = `Playlist: ${g_state.currentPlaylist.name} | Song ${songNum}/${totalSongs}: ${songName}`;
    playlistInfo.style.display = 'block';
    
    // Show/enable prev/next buttons
    prevBtn.style.display = 'inline-block';
    nextBtn.style.display = 'inline-block';
    prevBtn.disabled = songNum === 1;
    nextBtn.disabled = songNum === totalSongs;
  } else {
    // Hide playlist info and navigation buttons
    playlistInfo.style.display = 'none';
    prevBtn.style.display = 'none';
    nextBtn.style.display = 'none';
  }
}

// Navigate to previous song in playlist
async function playPreviousSong() {
  if (!g_state.currentPlaylist || g_state.currentSongIndex <= 0) return;
  
  g_state.currentSongIndex--;
  const url = g_state.currentPlaylist.urls[g_state.currentSongIndex];
  const success = await loadSongFromUrl(url);
  if (success) {
    updatePlaylistDisplay();
  } else {
    // Revert on error
    g_state.currentSongIndex++;
  }
}

// Navigate to next song in playlist
async function playNextSong() {
  if (!g_state.currentPlaylist || g_state.currentSongIndex >= g_state.currentPlaylist.urls.length - 1) return;
  
  g_state.currentSongIndex++;
  const url = g_state.currentPlaylist.urls[g_state.currentSongIndex];
  const success = await loadSongFromUrl(url);
  if (success) {
    updatePlaylistDisplay();
  } else {
    // Revert on error
    g_state.currentSongIndex--;
  }
}

// Set up auto-advance monitoring for playlist playback
let playbackMonitorInterval = null;
let wasPlaying = false;

function clearPlaylistState() {
  // Clear playlist state
  g_state.currentPlaylistId = null;
  g_state.currentPlaylist = null;
  g_state.currentSongIndex = -1;
  
  // Reset playlist dropdown
  const playlistDropdown = document.getElementById('active-playlist');
  if (playlistDropdown) {
    playlistDropdown.value = '';
  }
  
  // Update display
  updatePlaylistDisplay();
  
  // Clear monitoring interval
  if (playbackMonitorInterval) {
    clearInterval(playbackMonitorInterval);
    playbackMonitorInterval = null;
  }
}

function setupPlaylistAutoAdvance() {
  // Clear any existing monitor
  if (playbackMonitorInterval) {
    clearInterval(playbackMonitorInterval);
    playbackMonitorInterval = null;
  }
  
  // Only set up monitoring if we're in playlist mode
  if (!g_state.currentPlaylist || !g_state.player) return;
  
  wasPlaying = false;
  
  // Monitor playback state
  playbackMonitorInterval = setInterval(() => {
    if (!g_state.player || !g_state.currentPlaylist) {
      clearInterval(playbackMonitorInterval);
      playbackMonitorInterval = null;
      return;
    }
    
    const isPlaying = g_state.player.state === PLAYER_PLAYING;
    const position = g_state.player.position;
    const duration = g_state.player.duration;
    
    // Detect when playback stops after being in playing state
    // Check if we're within 100ms of the end
    if (wasPlaying && !isPlaying && duration > 0 && position >= duration - 0.1) {
      console.log('Song finished, auto-advancing to next song');
      wasPlaying = false;
      
      // Auto-advance to next song
      if (g_state.currentSongIndex < g_state.currentPlaylist.urls.length - 1) {
        playNextSong();
      } else {
        console.log('Reached end of playlist');
        updatePlaylistDisplay();
      }
    } else {
      wasPlaying = isPlaying;
    }
  }, 500); // Check every 500ms
}

function loadPlaylists() {
  try {
    const stored = localStorage.getItem(PLAYLISTS_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch (error) {
    console.error('Error loading playlists:', error);
    return [];
  }
}

function savePlaylists(playlists) {
  try {
    localStorage.setItem(PLAYLISTS_KEY, JSON.stringify(playlists));
  } catch (error) {
    console.error('Error saving playlists:', error);
  }
}

function renderPlaylists() {
  const playlists = loadPlaylists();
  const container = document.getElementById('playlists-container');
  
  if (playlists.length === 0) {
    container.innerHTML = '<p style="color: #666; font-style: italic;">No playlists yet. Create one to get started!</p>';
    return;
  }

  container.innerHTML = playlists.map(playlist => `
    <div style="border: 1px solid #d4a574; padding: 10px; margin-bottom: 10px; border-radius: 5px;">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <div>
          <strong>${escapeHtml(playlist.name)}</strong>
          <span style="color: #666; margin-left: 10px;">(${playlist.urls.length} songs)</span>
        </div>
        <div style="display: flex; gap: 5px;">
          <button class="edit-playlist-btn" data-id="${playlist.id}" style="padding: 5px 10px; background-color: #d4a574; color: white; border: none; border-radius: 3px; cursor: pointer;">Edit</button>
          <button class="delete-playlist-btn" data-id="${playlist.id}" style="padding: 5px 10px; background-color: #c44; color: white; border: none; border-radius: 3px; cursor: pointer;">Delete</button>
        </div>
      </div>
      <div style="margin-top: 5px; font-size: 0.9em; color: #666;">
        ${playlist.urls.slice(0, 3).map(url => `<div style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">• ${escapeHtml(url)}</div>`).join('')}
        ${playlist.urls.length > 3 ? `<div style="font-style: italic;">... and ${playlist.urls.length - 3} more</div>` : ''}
      </div>
    </div>
  `).join('');

  // Add event listeners
  document.querySelectorAll('.edit-playlist-btn').forEach(btn => {
    btn.addEventListener('click', () => editPlaylist(btn.dataset.id));
  });
  document.querySelectorAll('.delete-playlist-btn').forEach(btn => {
    btn.addEventListener('click', () => deletePlaylist(btn.dataset.id));
  });
  
  // Also update the playlist dropdown
  populatePlaylistDropdown();
}

function populatePlaylistDropdown() {
  const playlists = loadPlaylists();
  const select = document.getElementById('active-playlist');
  const currentValue = select.value;
  
  // Keep the "None" option and add all playlists
  select.innerHTML = '<option value="">None (single song)</option>' + 
    playlists.map(playlist => 
      `<option value="${playlist.id}">${escapeHtml(playlist.name)} (${playlist.urls.length} songs)</option>`
    ).join('');
  
  // Restore previous selection if it still exists
  if (currentValue && playlists.find(p => p.id === currentValue)) {
    select.value = currentValue;
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function showPlaylistForm(playlist = null) {
  currentEditingPlaylistId = playlist ? playlist.id : null;
  const form = document.getElementById('playlist-form');
  const title = document.getElementById('playlist-form-title');
  const nameInput = document.getElementById('playlist-name');
  const urlsContainer = document.getElementById('playlist-urls');

  title.textContent = playlist ? 'Edit Playlist' : 'Create New Playlist';
  nameInput.value = playlist ? playlist.name : '';
  
  // Clear and populate URL inputs
  urlsContainer.innerHTML = '';
  const urls = playlist ? playlist.urls : [''];
  urls.forEach((url, index) => {
    addUrlInput(url, index);
  });

  form.style.display = 'block';
}

function hidePlaylistForm() {
  document.getElementById('playlist-form').style.display = 'none';
  currentEditingPlaylistId = null;
}

function addUrlInput(value = '', index = null) {
  const urlsContainer = document.getElementById('playlist-urls');
  const urlDiv = document.createElement('div');
  urlDiv.style.cssText = 'display: flex; gap: 5px; margin-bottom: 8px; align-items: center;';
  
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'playlist-url-input';
  input.placeholder = 'https://example.com/song.musicxml';
  input.value = value;
  input.style.cssText = 'flex: 1; padding: 8px; box-sizing: border-box;';
  
  const removeBtn = document.createElement('button');
  removeBtn.textContent = '✕';
  removeBtn.style.cssText = 'padding: 5px 10px; background-color: #c44; color: white; border: none; border-radius: 3px; cursor: pointer;';
  removeBtn.addEventListener('click', () => urlDiv.remove());
  
  urlDiv.appendChild(input);
  urlDiv.appendChild(removeBtn);
  urlsContainer.appendChild(urlDiv);
}

function editPlaylist(id) {
  const playlists = loadPlaylists();
  const playlist = playlists.find(p => p.id === id);
  if (playlist) {
    showPlaylistForm(playlist);
  }
}

function deletePlaylist(id) {
  if (!confirm('Are you sure you want to delete this playlist?')) return;
  
  const playlists = loadPlaylists();
  const filtered = playlists.filter(p => p.id !== id);
  savePlaylists(filtered);
  renderPlaylists();
}

function savePlaylist() {
  const nameInput = document.getElementById('playlist-name');
  const name = nameInput.value.trim();
  
  if (!name) {
    alert('Please enter a playlist name');
    return;
  }

  const urlInputs = document.querySelectorAll('.playlist-url-input');
  const urls = Array.from(urlInputs)
    .map(input => input.value.trim())
    .filter(url => url !== '');

  if (urls.length === 0) {
    alert('Please add at least one URL');
    return;
  }

  const playlists = loadPlaylists();
  
  if (currentEditingPlaylistId) {
    // Update existing playlist
    const index = playlists.findIndex(p => p.id === currentEditingPlaylistId);
    if (index !== -1) {
      playlists[index] = {
        ...playlists[index],
        name,
        urls
      };
    }
  } else {
    // Create new playlist
    const newPlaylist = {
      id: Date.now().toString(),
      name,
      urls,
      createdAt: new Date().toISOString()
    };
    playlists.push(newPlaylist);
  }

  savePlaylists(playlists);
  renderPlaylists();
  hidePlaylistForm();
}

document.addEventListener('DOMContentLoaded', async () => {
  // Load the parameters from local storage and/or the URL.
  const params = new URLSearchParams(document.location.search);
  try {
    const stored = JSON.parse(window.localStorage.getItem(LOCALSTORAGE_KEY));
    g_state.params = new URLSearchParams([...stored.params]);
    // Use hardcoded options for rendering, only restore mute and respectLineBreaks from storage
    g_state.options = {
      unroll: false,
      horizontal: false,
      follow: true,
      mute: stored.options?.mute || false,
      respectLineBreaks: stored.options?.respectLineBreaks || false,
    };
  }
  catch {
    g_state.params = new URLSearchParams();
    g_state.options = DEFAULT_OPTIONS;
  }
  // URL params override everything
  params.entries().forEach(([key, value]) => { g_state.params.set(key, value); });
  g_state.params.set('output', DEFAULT_OUTPUT); // Too complicated to wait for MIDI output
  // Always ensure renderer uses the current default if not specified in URL
  if (!params.has('renderer')) {
    g_state.params.set('renderer', DEFAULT_RENDERER);
  }
  window.g_state = g_state;

  // Populate the samples list dynamically
  await populateSamplesList();

  // Populate the playlist dropdown
  populatePlaylistDropdown();

  // Build the UI.
  const rendererValue = g_state.params.get('renderer') ?? DEFAULT_RENDERER;
  console.log('Setting renderer to:', rendererValue, 'DEFAULT_RENDERER:', DEFAULT_RENDERER);
  document.querySelectorAll('input[name="renderer"]').forEach(input => {
    input.addEventListener('change', handleRendererChange);
    if (input.value === rendererValue) {
      input.checked = true;
      console.log('Checked renderer radio:', input.value);
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
  
  // Playlist navigation buttons
  document.getElementById('prev').addEventListener('click', async () => {
    console.log('Previous button clicked');
    await playPreviousSong();
  });
  
  document.getElementById('next').addEventListener('click', async () => {
    console.log('Next button clicked');
    await playNextSong();
  });
  
  document.getElementById('upload').addEventListener('change', handleFileUpload);
  document.getElementById('samples').addEventListener('change', handleSampleSelect);
  document.getElementById('ireal').addEventListener('change', handleIRealChange);
  document.getElementById('velocity').addEventListener('change', handleVelocityChange);
  document.getElementById('repeat').addEventListener('change', handleRepeatChange);
  
  // Playlist selection
  document.getElementById('active-playlist').addEventListener('change', async (e) => {
    const playlistId = e.target.value;
    if (playlistId) {
      console.log('Playlist selected:', playlistId);
      
      // Load the playlist
      const playlists = loadPlaylists();
      const playlist = playlists.find(p => p.id === playlistId);
      
      if (playlist && playlist.urls.length > 0) {
        // Store playlist state
        g_state.currentPlaylistId = playlistId;
        g_state.currentPlaylist = playlist;
        g_state.currentSongIndex = 0;
        
        // Load the first song
        const success = await loadSongFromUrl(playlist.urls[0]);
        if (success) {
          updatePlaylistDisplay();
        } else {
          // Reset playlist state on error
          g_state.currentPlaylistId = null;
          g_state.currentPlaylist = null;
          g_state.currentSongIndex = -1;
        }
      }
    } else {
      // Deselect playlist, back to single song mode
      console.log('Playlist deselected, back to single song mode');
      g_state.currentPlaylistId = null;
      g_state.currentPlaylist = null;
      g_state.currentSongIndex = -1;
      updatePlaylistDisplay();
    }
  });
  
  document.querySelectorAll('.option').forEach(element => {
    if (!!g_state.options[element.id.replace('option-', '')]) {
      element.checked = true;
    }
    element.addEventListener('change', handleOptionChange);
  });
  // Initialize and add listener for respect-line-breaks checkbox
  const respectLineBreaksCheckbox = document.getElementById('respect-line-breaks');
  respectLineBreaksCheckbox.checked = g_state.options.respectLineBreaks;
  respectLineBreaksCheckbox.addEventListener('change', handleOptionChange);
  window.addEventListener('keydown', handlePlayPauseKey);

  // Settings modal controls
  const settingsModal = document.getElementById('settings-modal');
  const settingsBtn = document.getElementById('settings-btn');
  const closeSettings = document.getElementById('close-settings');

  settingsBtn.addEventListener('click', () => {
    settingsModal.classList.add('show');
  });

  closeSettings.addEventListener('click', () => {
    settingsModal.classList.remove('show');
  });

  // Close modal when clicking outside the content
  settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) {
      settingsModal.classList.remove('show');
    }
  });

  // Close modal when a file is selected or URL is loaded
  document.getElementById('samples').addEventListener('change', () => {
    setTimeout(() => settingsModal.classList.remove('show'), 300);
  });

  document.getElementById('upload').addEventListener('change', () => {
    setTimeout(() => settingsModal.classList.remove('show'), 300);
  });

  document.getElementById('ireal').addEventListener('change', () => {
    setTimeout(() => settingsModal.classList.remove('show'), 300);
  });

  // Playlist modal controls
  const playlistModal = document.getElementById('playlist-modal');
  const managePlaylistsBtn = document.getElementById('manage-playlists-btn');
  const closePlaylistModal = document.getElementById('close-playlist-modal');
  const createPlaylistBtn = document.getElementById('create-playlist-btn');
  const cancelPlaylistBtn = document.getElementById('cancel-playlist-btn');
  const savePlaylistBtn = document.getElementById('save-playlist-btn');
  const addUrlBtn = document.getElementById('add-url-btn');

  managePlaylistsBtn.addEventListener('click', () => {
    renderPlaylists();
    playlistModal.style.display = 'block';
  });

  closePlaylistModal.addEventListener('click', () => {
    playlistModal.style.display = 'none';
    hidePlaylistForm();
  });

  // Close playlist modal when clicking outside
  playlistModal.addEventListener('click', (e) => {
    if (e.target === playlistModal) {
      playlistModal.style.display = 'none';
      hidePlaylistForm();
    }
  });

  createPlaylistBtn.addEventListener('click', () => {
    showPlaylistForm();
  });

  cancelPlaylistBtn.addEventListener('click', () => {
    hidePlaylistForm();
  });

  savePlaylistBtn.addEventListener('click', () => {
    savePlaylist();
  });

  addUrlBtn.addEventListener('click', () => {
    addUrlInput();
  });

  // Register service worker for PWA support
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/service-worker.js')
      .then((registration) => {
        console.log('Service Worker registered successfully:', registration.scope);
      })
      .catch((error) => {
        console.log('Service Worker registration failed:', error);
      });
  }

  // Start the app.
  await handleSampleSelect({ target: { value: g_state.params.get('sheet') ?? DEFAULT_SHEET }});
});
