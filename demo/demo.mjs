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
  AccompanimentConverter,
  parseMusicXml,
  parseMusicXmlTimemap,
  SaxonJSProcessor,
  convertUnpitchedToPitched,
  transposeMusicXml,
} from './build/musicxml-player.mjs';
import {
  Playlist,
  Converter,
  Version,
} from 'https://cdn.jsdelivr.net/npm/@music-i18n/ireal-musicxml@latest/+esm';
import { authManager } from './auth.mjs';

const DEFAULT_RENDERER = 'osmd';
const DEFAULT_OUTPUT = 'local';
const DEFAULT_SHEET = 'data/asa-branca.musicxml';
const DEFAULT_GROOVE = 'Default';
const DEFAULT_CONVERTER = 'vrv';
const DEFAULT_VELOCITY = 1;
const DEFAULT_REPEAT = 0;
const DEFAULT_TRANSPOSE = 0;

// Intercept Verovio font loading errors and downgrade to warnings
const originalError = console.error;
console.error = function (...args) {
  const message = args.join(' ');
  if (message.includes('SMuFL glyphs') || message.includes('Leipzig font')) {
    console.warn(...args);
  } else {
    originalError.apply(console, args);
  }
};

// List of CORS proxies to try in order
const CORS_PROXIES = [
  '/proxy?url=', // Our own backend proxy (most reliable)
  'https://corsproxy.io/?',
  'https://api.allorigins.win/raw?url=',
];

/**
 * Fetch a file from an external URL using the backend proxy.
 * The proxy handles URL conversion (Google Drive, Dropbox, etc.) and domain validation.
 */
async function fetchExternalUrl(url) {
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
      const response = await fetish(proxyUrl);
      if (response.ok) {
        return await response.arrayBuffer();
      }
    } catch (error) {
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
  metronome: false,
  respectLineBreaks: false,
  showMeasureNumbers: false,
};

const PLAYER_PLAYING = 1;

const LOCALSTORAGE_KEY = 'musicxml-player';
const PLAYLISTS_KEY = 'musicxml-player-playlists';

const g_state = {
  webmidi: null,
  player: null,
  params: null,
  musicXml: null,
  originalMusicXml: null, // Store original untransposed MusicXML
  tuning: '',
  options: DEFAULT_OPTIONS,
  // Individual track selection (more flexible than presets)
  tracks: {
    solo: true,
    piano: true,
    bass: true,
    strings: true,
    drums: true,
  },
  // Track the actual music source type
  currentMusicSource: 'samples', // 'samples', 'upload', 'url', 'playlist'
  // Playlist state
  currentPlaylistId: null,
  currentSongIndex: -1,
  currentPlaylist: null,
  // Pending settings (changed but not yet applied)
  pendingSettings: null,
};

async function createPlayer() {
  // Destroy previous player.
  g_state.player?.destroy();

  // Set the player parameters.
  const sheet = g_state.params.get('sheet');
  const output = g_state.params.get('output') ?? DEFAULT_OUTPUT;
  let renderer = g_state.params.get('renderer') ?? DEFAULT_RENDERER;
  console.log('[createPlayer] Initial renderer from params:', renderer);
  const groove = g_state.params.get('groove') ?? DEFAULT_GROOVE;
  let converter = g_state.params.get('converter') ?? DEFAULT_CONVERTER;
  const velocity = g_state.params.get('velocity') ?? DEFAULT_VELOCITY;
  const repeat = g_state.params.get('repeat') ?? DEFAULT_REPEAT;
  const transpose = g_state.params.get('transpose') ?? DEFAULT_TRANSPOSE;
  const options = g_state.options;
  console.log('[createPlayer] options.metronome:', options.metronome);

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
  document.getElementById('transpose').value = transpose;

  // Detect renderer and converter possibilities based on sheet.
  const base =
    sheet.startsWith('http') || sheet.startsWith('data/')
      ? sheet
      : `data/${sheet}`;
  const isExternalUrl = sheet.startsWith('http');

  for (const [k, v] of Object.entries({
    vrv: true,
    osmd: true,
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
    } catch {
      input.disabled = true;
      if (renderer === k) {
        console.log(
          `[createPlayer] Renderer ${k} is disabled, resetting to ${DEFAULT_RENDERER}`,
        );
        renderer = DEFAULT_RENDERER;
      }
    }
  }
  console.log('[createPlayer] Final renderer after checks:', renderer);
  document.getElementById(`renderer-${renderer}`).checked = true;

  // Auto-detect converter: prefer custom MIDI if available when only solo track is enabled,
  // transpose is 0, and metronome is off - otherwise use AccompanimentConverter
  let hasMidiFile = false;

  // Check if custom MIDI file exists in data directory (skip for external URLs)
  const baseName = base
    .replace(/\.(musicxml|mxl|xml)$/i, '')
    .replace(/^data\//, '');

  // Determine if we're in "solo only" mode (only melody, no band tracks)
  const soloOnlyMode =
    g_state.tracks.solo &&
    !g_state.tracks.piano &&
    !g_state.tracks.bass &&
    !g_state.tracks.strings &&
    !g_state.tracks.drums;

  // Check if we can use existing MIDI file:
  // - Must be solo-only mode
  // - Transpose must be 0 (no transposition)
  // - Metronome must be off
  const canUseMidiFile = soloOnlyMode && transpose === 0 && !options.metronome;

  // Only check for existing MIDI files if we can use them
  if (baseName !== 'remote-file' && canUseMidiFile) {
    try {
      const midiPath = base.replace(/\.\w+$/, '.mid');
      await fetish(midiPath, { method: 'HEAD' });
      hasMidiFile = true;
    } catch {
      // No .mid file on server - will use AccompanimentConverter
    }
  }

  // Choose converter: use cached MIDI only when all conditions are met, otherwise generate with AccompanimentConverter
  if (hasMidiFile && canUseMidiFile) {
    // Use existing MIDI file for solo-only mode with no transpose and no metronome
    converter = 'midi';
  } else {
    // Generate MIDI with AccompanimentConverter (handles all track combinations, transpose, and metronome)
    converter = 'accomp';
  }

  // Create new player.
  if (g_state.musicXml) {
    try {
      const converterInstance = await createConverter(
        converter,
        sheet,
        groove,
        renderer,
      );

      const player = await Player.create({
        musicXml: g_state.musicXml,
        container: 'sheet-container',
        renderer: await createRenderer(renderer, sheet, options),
        output: undefined, // Always use local synth
        converter: converterInstance,
        unroll: options.unroll, // For rendering - user controls whether to show repeats
        mute: options.mute,
        metronome: options.metronome,
        repeat: repeat === '-1' ? Infinity : Number(repeat),
        velocity: Number(velocity),
        horizontal: options.horizontal,
        followCursor: options.follow,
        soundfontUri: 'data/GeneralUserGS.sf3',
        //timemapXslUri: 'data/timemap.sef.json',
      });

      // Update the UI elements.

      const filename =
        player.title.toLowerCase().replace(/[/\\?%*:|"'<>\.,;\s]/g, '-') ??
        'untitled';
      const a1 = document.createElement('a');
      a1.setAttribute(
        'href',
        URL.createObjectURL(new Blob([player.musicXml], { type: 'text/xml' })),
      );
      a1.setAttribute('download', `${filename}.musicxml`);
      a1.innerText = 'Download MusicXML';
      document.getElementById('download-musicxml').appendChild(a1);
      const a2 = document.createElement('a');
      a2.setAttribute(
        'href',
        URL.createObjectURL(new Blob([player.midi], { type: 'audio/midi' })),
      );
      a2.setAttribute('download', `${filename}.mid`);
      a2.innerText = 'Download MIDI';
      document.getElementById('download-midi').appendChild(a2);

      // Save the state and player parameters.
      g_state.player = player;
      g_state.options = options;
      savePlayerOptions();

      // Set up auto-advance monitoring for playlists
      setupPlaylistAutoAdvance();
    } catch (error) {
      console.error('❌ Error creating player:', error);
      console.error('Error message:', error.message);
      console.error('Error stack:', error.stack);
      document.getElementById('error').textContent =
        `Error creating player: ${error.message}`;
    }
  }
}

async function createRenderer(renderer, sheet, options) {
  const base = `data/${sheet}`;
  document.querySelectorAll('.renderer-option').forEach((element) => {
    element.disabled = false;
  });
  switch (renderer) {
    case 'osmd':
      return new OpenSheetMusicDisplayRenderer(
        {
          newSystemFromXML: options.respectLineBreaks ?? false,
          drawMeasureNumbers: options.showMeasureNumbers ?? true,
        },
        {
          MinMeasureToDrawIndex: 0,
          MaxMeasureToDrawIndex: Number.MAX_SAFE_INTEGER,
          FillEmptyMeasuresWithWholeRests: true,
          MinimumDistanceBetweenSystems: 7,
          SystemLeftMargin: 0,
          SystemRightMargin: 0,
        },
      );
    case 'vrv':
      const vrvOptions = {
        fingeringScale: 0.6,
        justificationBracketGroup: 5,
        scale: 60,
      };
      // Note: Verovio's measure number display options may vary by version
      // The options barNumbers and barNumbersInterval are not supported in current version
      return new VerovioRenderer(vrvOptions);
    case 'mscore':
      document.querySelectorAll('.renderer-option').forEach((element) => {
        element.disabled = true;
      });
      return new MuseScoreRenderer(base.replace(/\.\w+$/, '.mscore.json'));
    case 'vrvs':
      document.querySelectorAll('.renderer-option').forEach((element) => {
        element.disabled = true;
      });
      return new VerovioStaticRenderer(
        [base.replace(/\.\w+$/, '.vrv.svg')],
        base.replace(/\.\w+$/, '.vrv.json'),
      );
  }
}

async function createConverter(converter, sheet, groove, renderer) {
  const base =
    sheet.startsWith('http') || sheet.startsWith('data/')
      ? sheet
      : `data/${sheet}`;

  // Extract base filename for cache lookup
  let baseName = sheet.replace(/\.(musicxml|mxl|xml)$/i, '');
  if (baseName.startsWith('data/')) {
    baseName = baseName.replace(/^data\//, '');
  }

  // Note: We no longer use IndexedDB cached MIDI here because it doesn't
  // account for accompaniment mode changes. AccompanimentConverter will
  // generate fresh MIDI with the correct mode.

  switch (converter) {
    case 'midi':
      const midi = base.replace(/\.\w+$/, '.mid');
      try {
        const timemap = base.replace(/\.\w+$/, '.timemap.json');
        await fetish(timemap, { method: 'HEAD' });
        return new FetchConverter(midi, timemap);
      } catch {
        return new FetchConverter(midi);
      }
    case 'vrv':
      // Use VerovioConverter for all accompaniment modes
      return new VerovioConverter(g_state.vrvOptions);
    case 'accomp':
      // Use AccompanimentConverter to generate band accompaniment
      return new AccompanimentConverter({
        bandEnergy: 'medium',
        solo: g_state.tracks.solo,
        piano: g_state.tracks.piano,
        bass: g_state.tracks.bass,
        strings: g_state.tracks.strings,
        drums: g_state.tracks.drums,
        drummerPracticeMode: true,
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
      return new VerovioStaticConverter(
        base.replace(/\.\w+$/, '.mid'),
        base.replace(/\.\w+$/, '.vrv.json'),
      );
  }
}

function handleRendererChange(e) {
  // Settings are applied when modal closes, not immediately
  if (!g_state.pendingSettings) return;
  g_state.pendingSettings.renderer = e.target.value;
}

function handleTrackChange(e) {
  // Settings are applied when modal closes, not immediately
  if (!g_state.pendingSettings) return;
  const trackName = e.target.id.replace('track-', ''); // e.g., 'track-solo' -> 'solo'
  g_state.pendingSettings.tracks[trackName] = e.target.checked;
}

function handleMusicSourceChange(e) {
  // Update which source is selected
  if (!g_state.pendingSettings) return;
  g_state.pendingSettings.musicSource = e.target.value;
}

function handleSettingsOpen() {
  // Initialize pending settings with current values
  const currentRenderer = g_state.params.get('renderer') ?? DEFAULT_RENDERER;
  const currentSheet = g_state.params.get('sheet') ?? DEFAULT_SHEET;
  const currentSource = determineCurrentMusicSource();

  // Determine the sample value - should be the sheet name for samples
  let sampleValue = '';
  if (currentSource === 'samples') {
    sampleValue = currentSheet;
  }

  g_state.pendingSettings = {
    musicSource: currentSource,
    sampleValue: sampleValue,
    uploadFile: null,
    urlValue: currentSheet.startsWith('http') ? currentSheet : '',
    playlistId: g_state.currentPlaylistId || '',
    renderer: currentRenderer,
    tracks: { ...g_state.tracks }, // Copy track settings
    options: { ...g_state.options },
  };

  // Set the appropriate music source radio button
  const sourceRadios = document.querySelectorAll('input[name="music-source"]');
  sourceRadios.forEach((radio) => {
    if (radio.value === currentSource) {
      radio.checked = true;
    }
  });

  // Set the renderer radio buttons
  const rendererRadios = document.querySelectorAll('input[name="renderer"]');
  rendererRadios.forEach((radio) => {
    if (radio.value === currentRenderer) {
      radio.checked = true;
    }
  });

  // Set the option checkboxes to match current state
  document.getElementById('option-metronome').checked =
    g_state.options.metronome;
  document.getElementById('option-mute').checked = g_state.options.mute;
  document.getElementById('respect-line-breaks').checked =
    g_state.options.respectLineBreaks;
  document.getElementById('show-measure-numbers').checked =
    g_state.options.showMeasureNumbers;

  // Set the track checkboxes to match current state
  document.getElementById('track-solo').checked = g_state.tracks.solo;
  document.getElementById('track-piano').checked = g_state.tracks.piano;
  document.getElementById('track-bass').checked = g_state.tracks.bass;
  document.getElementById('track-strings').checked = g_state.tracks.strings;
  document.getElementById('track-drums').checked = g_state.tracks.drums;

  // Set the actual input values
  if (currentSource === 'samples') {
    const samplesDropdown = document.getElementById('samples');

    // The dropdown options include 'data/' prefix, so add it if not present
    let dropdownValue = currentSheet;
    if (
      !dropdownValue.startsWith('data/') &&
      !dropdownValue.startsWith('http')
    ) {
      dropdownValue = 'data/' + dropdownValue;
    }

    samplesDropdown.value = dropdownValue;

    // Update pendingSettings to use the full path with data/ prefix
    g_state.pendingSettings.sampleValue = dropdownValue;
  } else if (currentSource === 'url') {
    document.getElementById('ireal').value = currentSheet;
  } else if (currentSource === 'playlist') {
    document.getElementById('active-playlist').value =
      g_state.currentPlaylistId || '';
  }
}

function determineCurrentMusicSource() {
  // Use explicitly tracked source if available
  if (g_state.currentMusicSource) {
    return g_state.currentMusicSource;
  }

  // Fallback to heuristics
  if (g_state.currentPlaylistId) return 'playlist';
  const sheet = g_state.params.get('sheet') ?? DEFAULT_SHEET;
  if (sheet.startsWith('http')) return 'url';
  if (sheet.startsWith('data/')) return 'samples';
  return 'upload';
}

async function handleApplySettings() {
  if (!g_state.pendingSettings) return;

  const settings = g_state.pendingSettings;

  // Track what changed to determine if we need to reload
  const rendererChanged = settings.renderer !== g_state.params.get('renderer');

  // Check if any track selection changed
  const tracksChanged =
    settings.tracks.solo !== g_state.tracks.solo ||
    settings.tracks.piano !== g_state.tracks.piano ||
    settings.tracks.bass !== g_state.tracks.bass ||
    settings.tracks.strings !== g_state.tracks.strings ||
    settings.tracks.drums !== g_state.tracks.drums;

  // Check if any renderer options changed (these require reload)
  const currentOptions = g_state.options;
  const metronomeChanged =
    settings.options.metronome !== currentOptions.metronome;
  const respectLineBreaksChanged =
    settings.options.respectLineBreaks !== currentOptions.respectLineBreaks;
  const showMeasureNumbersChanged =
    settings.options.showMeasureNumbers !== currentOptions.showMeasureNumbers;
  const renderOptionsChanged =
    metronomeChanged || respectLineBreaksChanged || showMeasureNumbersChanged;

  // Apply renderer
  if (rendererChanged) {
    g_state.params.set('renderer', settings.renderer);
  }

  // Apply track selection
  if (tracksChanged) {
    g_state.tracks = { ...settings.tracks };
    savePlayerOptions();
  }

  // Apply options
  g_state.options = { ...settings.options };
  savePlayerOptions();

  // Apply velocity and repeat to existing player if it exists (these can be changed without reload)
  if (settings.velocity !== undefined) {
    g_state.params.set('velocity', settings.velocity);
    if (g_state.player) {
      g_state.player.velocity = Number(settings.velocity);
    }
  }
  if (settings.repeat !== undefined) {
    g_state.params.set('repeat', settings.repeat);
    if (g_state.player) {
      g_state.player.repeat =
        settings.repeat === '-1' ? Infinity : Number(settings.repeat);
    }
  }

  // Check if transpose changed (requires player recreation)
  const currentTranspose = g_state.params.get('transpose') ?? DEFAULT_TRANSPOSE;
  const transposeChanged =
    settings.transpose !== undefined &&
    Number(settings.transpose) !== Number(currentTranspose);

  if (settings.transpose !== undefined) {
    g_state.params.set('transpose', settings.transpose);
    // Re-transpose from original MusicXML
    if (g_state.originalMusicXml) {
      g_state.musicXml = transposeMusicXml(
        g_state.originalMusicXml,
        Number(settings.transpose),
      );
    }
  }

  // Apply mute to existing player if it exists (can be changed without reload)
  if (g_state.player) {
    g_state.player.mute = settings.options.mute;
  }

  // Apply music source change if different
  const musicSourceChanged = await applyMusicSourceChange(settings);

  // Clear pending settings
  g_state.pendingSettings = null;

  // Close the modal
  document.getElementById('settings-modal').classList.remove('show');

  // Reload player if any of these changed:
  // musicSourceChanged == true: music source didn't change, but we may need reload for other settings
  // musicSourceChanged == false: music source changed, handler already called createPlayer()
  if (
    musicSourceChanged &&
    (rendererChanged ||
      tracksChanged ||
      renderOptionsChanged ||
      transposeChanged)
  ) {
    createPlayer();
  }
  // If musicSourceChanged is false, the music source handler already called createPlayer()
  // with all the updated settings, so we don't need to call it again
}

async function applyMusicSourceChange(settings) {
  const currentSource = determineCurrentMusicSource();
  const currentSheet = g_state.params.get('sheet') ?? DEFAULT_SHEET;

  // Check if source changed
  const sourceChanged = settings.musicSource !== currentSource;

  // Check if value changed within the same source type
  let valueChanged = false;
  if (settings.musicSource === 'samples') {
    // Normalize paths for comparison (both should have data/ prefix or neither)
    const normalizedCurrent = currentSheet.startsWith('data/')
      ? currentSheet
      : 'data/' + currentSheet;
    const normalizedSettings = settings.sampleValue?.startsWith('data/')
      ? settings.sampleValue
      : 'data/' + (settings.sampleValue || '');
    valueChanged =
      settings.sampleValue && normalizedSettings !== normalizedCurrent;
  } else if (settings.musicSource === 'url') {
    valueChanged = settings.urlValue && settings.urlValue !== currentSheet;
  } else if (settings.musicSource === 'playlist') {
    valueChanged =
      settings.playlistId && settings.playlistId !== g_state.currentPlaylistId;
  }

  // If source changed OR value changed, load the new music
  if (sourceChanged || valueChanged) {
    switch (settings.musicSource) {
      case 'samples':
        if (settings.sampleValue) {
          // Clear pendingSettings temporarily so handleSampleSelect actually loads the file
          const savedPending = g_state.pendingSettings;
          g_state.pendingSettings = null;
          await handleSampleSelect({ target: { value: settings.sampleValue } });
          g_state.pendingSettings = savedPending;
          return false; // Don't call createPlayer, handleSampleSelect already did
        }
        break;
      case 'upload':
        if (settings.uploadFiles) {
          // Clear pendingSettings temporarily
          const savedPending = g_state.pendingSettings;
          g_state.pendingSettings = null;
          await handleFileUpload({ target: { files: settings.uploadFiles } });
          g_state.pendingSettings = savedPending;
          return false; // Don't call createPlayer, handleFileUpload already did
        }
        return false;
      case 'url':
        if (settings.urlValue) {
          // Clear pendingSettings temporarily
          const savedPending = g_state.pendingSettings;
          g_state.pendingSettings = null;
          await handleIRealChange({ target: { value: settings.urlValue } });
          g_state.pendingSettings = savedPending;
          return false; // Don't call createPlayer, handleIRealChange already did
        }
        break;
      case 'playlist':
        if (settings.playlistId) {
          document.getElementById('active-playlist').value =
            settings.playlistId;
          // Clear pendingSettings temporarily
          const savedPending = g_state.pendingSettings;
          g_state.pendingSettings = null;
          await handlePlaylistChange({
            target: { value: settings.playlistId },
          });
          g_state.pendingSettings = savedPending;
          return false; // Don't call createPlayer, handlePlaylistChange already did
        }
        break;
    }
  }

  // Settings changed but not music source - need reload for renderer/accompaniment
  return true;
}

function handleCancelSettings() {
  g_state.pendingSettings = null;
  document.getElementById('settings-modal').classList.remove('show');
}

async function handlePlaylistChange(e) {
  const playlistId = e.target.value;

  // When called from settings modal, just store the playlist selection
  if (g_state.pendingSettings) {
    g_state.pendingSettings.musicSource = 'playlist';
    g_state.pendingSettings.playlistId = playlistId;
    return;
  }

  // Mark this as a playlist source
  g_state.currentMusicSource = 'playlist';

  // Otherwise, apply immediately
  if (playlistId) {
    // Load the playlist
    const playlists = loadPlaylists();
    const playlist = playlists.find((p) => p.id === playlistId);

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
    g_state.currentPlaylistId = null;
    g_state.currentPlaylist = null;
    g_state.currentSongIndex = -1;
    updatePlaylistDisplay();
  }
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
    } else {
      g_state.player.play();
    }
  }
}

async function handleSampleSelect(e) {
  // When called from settings modal, just store the selection
  if (g_state.pendingSettings) {
    g_state.pendingSettings.musicSource = 'samples';
    g_state.pendingSettings.sampleValue = e.target.value;
    return;
  }
  // Otherwise, apply immediately (for initial load)
  if (!e.target.value) return;

  // Clear playlist state when manually selecting a sample
  clearPlaylistState();

  // Mark this as a sample source
  g_state.currentMusicSource = 'samples';

  let sheet = e.target.value;
  let option = document.querySelector(`#samples option[value="${sheet}"]`);
  if (!option) {
    sheet = DEFAULT_SHEET;
    option = document.querySelector(`#samples option[value="${sheet}"]`);
  }

  // If still no option (e.g., non-authenticated user with empty samples list),
  // just load the sheet directly without trying to read data attributes
  if (!option) {
    g_state.params.set('sheet', sheet);
    g_state.params.set('renderer', DEFAULT_RENDERER);
    g_state.params.set('converter', DEFAULT_CONVERTER);

    // Load directly
    const buffer = await (await fetish(sheet)).arrayBuffer();
    const filename = sheet.split('/').pop();
    await handleFileBuffer(filename, buffer);
    return;
  }

  // Clear playlist state when manually selecting a sample
  clearPlaylistState();

  try {
    // Renderer and converter are determined by settings and auto-detection, not per-file
    if (sheet.endsWith('.musicxml') || sheet.endsWith('.mxl')) {
      // Fetch the MusicXML file
      const buffer = await (await fetish(sheet)).arrayBuffer();

      // Extract filename from path
      const filename = sheet.split('/').pop();

      // Use handleFileBuffer which will parse, convert unpitched percussion, and ensure MIDI exists
      await handleFileBuffer(filename, buffer);
    } else {
      // For iReal Pro files, just load the first song
      const ireal = await (await fetish(sheet)).text();
      const playlist = new Playlist(ireal);
      if (playlist.songs.length > 0) {
        const song = playlist.songs[0];
        const musicXml = Converter.convert(song, {
          notation: 'rhythmic',
          date: false,
        });
        // Store original and apply transposition
        g_state.originalMusicXml = musicXml;
        const transpose = g_state.params.get('transpose') ?? DEFAULT_TRANSPOSE;
        g_state.musicXml = transposeMusicXml(musicXml, Number(transpose));
        g_state.params.set('sheet', sheet);
        g_state.params.set('groove', DEFAULT_GROOVE);
        createPlayer();
      }
    }
  } catch (error) {
    console.error(error);
  }
}

async function handleIRealChange(e) {
  let url = e.target.value.trim();
  if (!url) return;

  // When called from settings modal, just store the URL
  if (g_state.pendingSettings) {
    g_state.pendingSettings.musicSource = 'url';
    g_state.pendingSettings.urlValue = url;
    return;
  }

  // Check if user has permission to load external URLs (premium feature)
  if (!checkFeatureAccess('external-urls')) {
    e.target.value = '';
    return;
  }

  // Clear playlist state when manually entering a URL
  clearPlaylistState();

  // Mark this as a URL source
  g_state.currentMusicSource = 'url';

  try {
    // Fetch the file using the generic helper (handles CORS automatically)
    const buffer = await fetchExternalUrl(url);

    // Extract filename for display and caching
    // For Google Drive/Dropbox/OneDrive URLs, use a generic name
    let filename;
    if (
      url.includes('drive.google.com') ||
      url.includes('dropbox.com') ||
      url.includes('onedrive.live.com')
    ) {
      // Determine file extension from buffer content
      const first4Bytes = new Uint8Array(buffer.slice(0, 4));
      const isPK = first4Bytes[0] === 0x50 && first4Bytes[1] === 0x4b; // PK (ZIP/MXL)
      filename = isPK ? 'remote-file.mxl' : 'remote-file.musicxml';
    } else {
      filename = url.split('/').pop().split('?')[0] || 'remote-file.musicxml';
    }

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
    document.getElementById('error').textContent =
      `Failed to load MusicXML from URL. Make sure the URL is accessible and the file is a valid MusicXML file. (${error.message})`;
  }
}

async function handleFileBuffer(filename, buffer, skipCacheDelete = false) {
  try {
    const parseResult = await parseMusicXml(buffer, new SaxonJSProcessor());
    // Store original and apply transposition
    g_state.originalMusicXml = parseResult.musicXml;
    const transpose = g_state.params.get('transpose') ?? DEFAULT_TRANSPOSE;
    g_state.musicXml = transposeMusicXml(
      parseResult.musicXml,
      Number(transpose),
    );
    g_state.params.set('sheet', filename);

    const baseName = filename.replace(/\.(musicxml|mxl|xml)$/i, '');

    // Only delete cache and generate MIDI if user didn't provide MIDI file
    if (!skipCacheDelete) {
      await deleteMidiFile(baseName);
      await ensureMidiFile(filename, g_state.musicXml);
    }

    // For URL-loaded files, try using MuseScore converter which works better with OSMD renderer
    // MuseScore's timemap has better alignment with OSMD's cursor tracking
    const isUrl = filename.startsWith('http');
    g_state.params.set('converter', isUrl ? 'ms' : 'vrv');

    createPlayer();
  } catch (error) {
    console.error('Error processing uploaded file:', error);
    try {
      const ireal = new TextDecoder().decode(buffer);
      populateSheets(ireal);
    } catch (error2) {
      document.getElementById('error').textContent =
        'This file is not recognized as either MusicXML or iReal Pro.';
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
        new SaxonJSProcessor(),
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
      tuning: g_state.tuning,
    });

    await converter.initialize(processedMusicXml, {
      container: document.createElement('div'),
      musicXml: processedMusicXml,
      renderer: {},
      converter: {},
      output: null,
      soundfontUri: '',
      unrollXslUri:
        'https://raw.githubusercontent.com/infojunkie/musicxml-midi/main/build/unroll.sef.json',
      timemapXslUri:
        'https://raw.githubusercontent.com/infojunkie/musicxml-midi/main/build/timemap.sef.json',
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
      new SaxonJSProcessor(),
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
        timestamp: Date.now(),
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

  // Mark this as an upload source
  g_state.currentMusicSource = 'upload';

  // Check if user uploaded both MusicXML and MIDI
  const musicXmlFile = files.find((f) =>
    f.name.match(/\.(musicxml|mxl|xml)$/i),
  );
  const midiFile = files.find((f) => f.name.match(/\.mid$/i));

  if (!musicXmlFile) {
    document.getElementById('error').textContent =
      'Please upload a MusicXML file (.musicxml, .mxl, or .xml)';
    return;
  }

  if (musicXmlFile.size > 1 * 1024 * 1024) {
    document.getElementById('error').textContent =
      'MusicXML file is too large (max 1MB).';
    return;
  }

  // If MIDI file provided, store it in cache before processing MusicXML
  if (midiFile) {
    if (midiFile.size > 1 * 1024 * 1024) {
      document.getElementById('error').textContent =
        'MIDI file is too large (max 1MB).';
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
            const parseResult = await parseMusicXml(
              xmlUpload.target.result,
              new SaxonJSProcessor(),
            );
            const timemap = await parseMusicXmlTimemap(
              parseResult.musicXml,
              'https://raw.githubusercontent.com/infojunkie/musicxml-midi/main/build/timemap.sef.json',
              new SaxonJSProcessor(),
            );

            // Store user-provided MIDI in cache
            await storeMidiFile(baseName, midiBuffer, timemap);

            // Now process the MusicXML file (skip cache deletion since we just stored user MIDI)
            await handleFileBuffer(
              musicXmlFile.name,
              xmlUpload.target.result,
              true,
            );
            resolve();
          } catch (error) {
            console.error('Error processing files:', error);
            document.getElementById('error').textContent =
              'Error processing uploaded files.';
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
  const newOptions = {
    unroll: false, // Always unchecked - show repeat signs
    horizontal: false, // Always unchecked
    mute: !!document.getElementById('option-mute').checked,
    metronome: !!document.getElementById('option-metronome').checked,
    follow: true, // Always checked
    respectLineBreaks: !!document.getElementById('respect-line-breaks').checked,
    showMeasureNumbers: !!document.getElementById('show-measure-numbers')
      .checked,
  };

  // If in settings modal, update pending settings
  if (g_state.pendingSettings) {
    g_state.pendingSettings.options = newOptions;
    return;
  }

  // Otherwise apply immediately
  g_state.options = newOptions;
  if (e.target.id === 'option-mute') {
    if (g_state.player) {
      g_state.player.mute = g_state.options.mute;
    }
    savePlayerOptions();
  } else {
    createPlayer();
  }
}

function handleVelocityChange(e) {
  // Store in pending settings if modal is open
  if (g_state.pendingSettings) {
    g_state.pendingSettings.velocity = e.target.value;
    return;
  }

  g_state.params.set('velocity', e.target.value);
  if (g_state.player) {
    g_state.player.velocity = Number(e.target.value);
  }
  savePlayerOptions();
}

function handleRepeatChange(e) {
  // Store in pending settings if modal is open
  if (g_state.pendingSettings) {
    g_state.pendingSettings.repeat = e.target.value;
    return;
  }

  g_state.params.set('repeat', e.target.value);
  if (g_state.player) {
    g_state.player.repeat =
      e.target.value === '-1' ? Infinity : Number(e.target.value);
  }
  savePlayerOptions();
}

function handleTransposeChange(e) {
  // Store in pending settings if modal is open
  if (g_state.pendingSettings) {
    g_state.pendingSettings.transpose = e.target.value;
    return;
  }

  g_state.params.set('transpose', e.target.value);
  savePlayerOptions();

  // Re-transpose from original MusicXML
  if (g_state.originalMusicXml) {
    g_state.musicXml = transposeMusicXml(
      g_state.originalMusicXml,
      Number(e.target.value),
    );
  }

  // Recreate player with newly transposed MusicXML
  createPlayer();
}

function savePlayerOptions() {
  try {
    window.localStorage.setItem(
      LOCALSTORAGE_KEY,
      JSON.stringify({
        params: [...g_state.params.entries()],
        options: g_state.options,
        tracks: g_state.tracks,
      }),
    );
  } catch (error) {
    console.warn(`Error saving player state: ${error}`);
  }
}

async function populateSamplesList() {
  const samplesSelect = document.getElementById('samples');
  samplesSelect.innerHTML = '<option value="">-- Choose --</option>';

  try {
    // Fetch the list of files generated by the server
    const response = await fetish('data/files.json');
    const musicFiles = await response.json();

    console.log(`Loading ${musicFiles.length} MusicXML files from files.json`);

    // Add each file to the dropdown
    for (const file of musicFiles) {
      // Create a display name from the filename
      const displayName = file
        .replace(/\.(musicxml|mxl)$/i, '')
        .replace(/[-_]/g, ' ')
        .replace(/\b\w/g, (l) => l.toUpperCase());

      const option = document.createElement('option');
      option.value = `data/${file}`;
      option.text = displayName;
      samplesSelect.add(option);
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

    // Extract filename for display and caching
    // For Google Drive/Dropbox/OneDrive URLs, use a generic name
    let filename;
    if (
      url.includes('drive.google.com') ||
      url.includes('dropbox.com') ||
      url.includes('onedrive.live.com')
    ) {
      // Determine file extension from buffer content
      const first4Bytes = new Uint8Array(buffer.slice(0, 4));
      const isPK = first4Bytes[0] === 0x50 && first4Bytes[1] === 0x4b; // PK (ZIP/MXL)
      filename = isPK ? 'remote-file.mxl' : 'remote-file.musicxml';
    } else {
      filename = url.split('/').pop().split('?')[0] || 'remote-file.musicxml';
    }

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
    document.getElementById('error').textContent =
      `Failed to load song: ${errorMsg}`;
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
  if (
    !g_state.currentPlaylist ||
    g_state.currentSongIndex >= g_state.currentPlaylist.urls.length - 1
  )
    return;

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
    if (
      wasPlaying &&
      !isPlaying &&
      duration > 0 &&
      position >= duration - 0.1
    ) {
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
    container.innerHTML =
      '<p style="color: #666; font-style: italic;">No playlists yet. Create one to get started!</p>';
    return;
  }

  container.innerHTML = playlists
    .map(
      (playlist) => `
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
        ${playlist.urls
          .slice(0, 3)
          .map(
            (url) =>
              `<div style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">• ${escapeHtml(url)}</div>`,
          )
          .join('')}
        ${playlist.urls.length > 3 ? `<div style="font-style: italic;">... and ${playlist.urls.length - 3} more</div>` : ''}
      </div>
    </div>
  `,
    )
    .join('');

  // Add event listeners
  document.querySelectorAll('.edit-playlist-btn').forEach((btn) => {
    btn.addEventListener('click', () => editPlaylist(btn.dataset.id));
  });
  document.querySelectorAll('.delete-playlist-btn').forEach((btn) => {
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
  select.innerHTML =
    '<option value="">None (single song)</option>' +
    playlists
      .map(
        (playlist) =>
          `<option value="${playlist.id}">${escapeHtml(playlist.name)} (${playlist.urls.length} songs)</option>`,
      )
      .join('');

  // Restore previous selection if it still exists
  if (currentValue && playlists.find((p) => p.id === currentValue)) {
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
  urlDiv.style.cssText =
    'display: flex; gap: 5px; margin-bottom: 8px; align-items: center;';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'playlist-url-input';
  input.placeholder = 'https://example.com/song.musicxml';
  input.value = value;
  input.style.cssText = 'flex: 1; padding: 8px; box-sizing: border-box;';

  const removeBtn = document.createElement('button');
  removeBtn.textContent = '✕';
  removeBtn.style.cssText =
    'padding: 5px 10px; background-color: #c44; color: white; border: none; border-radius: 3px; cursor: pointer;';
  removeBtn.addEventListener('click', () => urlDiv.remove());

  urlDiv.appendChild(input);
  urlDiv.appendChild(removeBtn);
  urlsContainer.appendChild(urlDiv);
}

function editPlaylist(id) {
  const playlists = loadPlaylists();
  const playlist = playlists.find((p) => p.id === id);
  if (playlist) {
    showPlaylistForm(playlist);
  }
}

function deletePlaylist(id) {
  if (!confirm('Are you sure you want to delete this playlist?')) return;

  const playlists = loadPlaylists();
  const filtered = playlists.filter((p) => p.id !== id);
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
    .map((input) => input.value.trim())
    .filter((url) => url !== '');

  if (urls.length === 0) {
    alert('Please add at least one URL');
    return;
  }

  const playlists = loadPlaylists();

  if (currentEditingPlaylistId) {
    // Update existing playlist
    const index = playlists.findIndex((p) => p.id === currentEditingPlaylistId);
    if (index !== -1) {
      playlists[index] = {
        ...playlists[index],
        name,
        urls,
      };
    }
  } else {
    // Create new playlist
    const newPlaylist = {
      id: Date.now().toString(),
      name,
      urls,
      createdAt: new Date().toISOString(),
    };
    playlists.push(newPlaylist);
  }

  savePlaylists(playlists);
  renderPlaylists();
  hidePlaylistForm();
}

// ========== Authentication Functions ==========

/**
 * Initialize authentication system
 */
async function initializeAuth() {
  try {
    await authManager.initialize();
    updateAuthUI();

    // Set up event listeners
    document.getElementById('login-btn').addEventListener('click', () => {
      authManager.login();
    });

    document.getElementById('register-btn').addEventListener('click', () => {
      authManager.register();
    });

    document
      .getElementById('logout-btn')
      .addEventListener('click', async () => {
        await authManager.logout();
        updateAuthUI();
      });
  } catch (error) {
    console.error('Auth initialization failed:', error);
  }
}

/**
 * Update UI based on authentication status
 */
function updateAuthUI() {
  const isAuth = authManager.isUserAuthenticated();
  const user = authManager.getUser();
  const tier = authManager.getSubscriptionTier();

  // UI elements
  const loginBtn = document.getElementById('login-btn');
  const registerBtn = document.getElementById('register-btn');
  const logoutBtn = document.getElementById('logout-btn');
  const userInfo = document.getElementById('user-info');
  const userName = document.getElementById('user-name');
  const userAvatar = document.getElementById('user-avatar');
  const subscriptionBadge = document.getElementById('subscription-badge');
  const settingsBtn = document.getElementById('settings-btn');

  // If auth is not enabled, hide all auth UI
  if (!authManager.authEnabled) {
    loginBtn.style.display = 'none';
    registerBtn.style.display = 'none';
    logoutBtn.style.display = 'none';
    userInfo.classList.remove('show');
    return;
  }

  if (isAuth && user) {
    // Show user info
    userInfo.classList.add('show');
    userName.textContent = user.given_name || user.email || 'User';
    userAvatar.textContent = (
      user.given_name?.[0] ||
      user.email?.[0] ||
      'U'
    ).toUpperCase();

    // Update subscription badge
    subscriptionBadge.className = '';
    subscriptionBadge.classList.add(tier);
    subscriptionBadge.textContent = tier;

    // Show logout button and settings
    logoutBtn.style.display = 'inline-block';
    loginBtn.style.display = 'none';
    registerBtn.style.display = 'none';
    settingsBtn.style.display = 'flex';
  } else {
    // Show login/register buttons, hide settings
    userInfo.classList.remove('show');
    loginBtn.style.display = 'inline-block';
    registerBtn.style.display = 'inline-block';
    logoutBtn.style.display = 'none';
    settingsBtn.style.display = 'none';
  }
}

/**
 * Check if user can access a feature and show appropriate message
 * @param {string} feature - Feature name
 * @returns {boolean} - Whether access is granted
 */
function checkFeatureAccess(feature) {
  const access = authManager.canAccessFeature(feature);

  if (!access.allowed) {
    const errorElement = document.getElementById('error');
    errorElement.textContent = access.reason;
    errorElement.style.color = '#d32f2f';

    // Clear error after 5 seconds
    setTimeout(() => {
      errorElement.textContent = '';
    }, 5000);

    return false;
  }

  return true;
}

// ========== Main Application ==========

document.addEventListener('DOMContentLoaded', async () => {
  // Initialize authentication
  await initializeAuth();

  // Check if user is authenticated (when auth is enabled)
  const isAuthenticated =
    !authManager.authEnabled || authManager.isUserAuthenticated();

  // Get URL parameters first
  const params = new URLSearchParams(document.location.search);

  // For non-authenticated users, force default music and hide settings
  if (!isAuthenticated) {
    // Force default sheet only
    g_state.params = new URLSearchParams();
    g_state.params.set('sheet', DEFAULT_SHEET);
    g_state.params.set('renderer', DEFAULT_RENDERER);
    g_state.params.set('converter', DEFAULT_CONVERTER);
    g_state.params.set('output', DEFAULT_OUTPUT);
    g_state.options = DEFAULT_OPTIONS;
  } else {
    // Authenticated users: Load from storage/URL
    try {
      const stored = JSON.parse(window.localStorage.getItem(LOCALSTORAGE_KEY));
      g_state.params = new URLSearchParams([...stored.params]);
      // Use hardcoded options for rendering, only restore mute and respectLineBreaks from storage
      g_state.options = {
        unroll: false,
        horizontal: false,
        follow: true,
        mute: stored.options?.mute || false,
        metronome: stored.options?.metronome || false,
        respectLineBreaks: stored.options?.respectLineBreaks || false,
        showMeasureNumbers: stored.options?.showMeasureNumbers ?? false,
      };
      // Restore accompaniment mode
      g_state.tracks = stored.tracks || {
        solo: true,
        piano: true,
        bass: true,
        strings: true,
        drums: true,
      };
    } catch {
      g_state.params = new URLSearchParams();
      g_state.options = DEFAULT_OPTIONS;
      g_state.tracks = {
        solo: true,
        piano: true,
        bass: true,
        strings: true,
        drums: true,
      };
    }
    // URL params override everything for authenticated users
    params.entries().forEach(([key, value]) => {
      g_state.params.set(key, value);
    });
  }

  g_state.params.set('output', DEFAULT_OUTPUT); // Too complicated to wait for MIDI output
  // Always ensure renderer uses the current default if not specified
  if (!params.has('renderer')) {
    g_state.params.set('renderer', DEFAULT_RENDERER);
  }
  window.g_state = g_state;

  // Only populate samples and playlists for authenticated users
  if (isAuthenticated) {
    // Populate the samples list dynamically
    await populateSamplesList();
    // Populate the playlist dropdown
    populatePlaylistDropdown();
  }

  // Build the UI.
  const rendererValue = g_state.params.get('renderer') ?? DEFAULT_RENDERER;
  document.querySelectorAll('input[name="renderer"]').forEach((input) => {
    if (input.value === rendererValue) {
      input.checked = true;
    }
  });
  // Add event listeners AFTER setting checked states to avoid triggering events
  document.querySelectorAll('input[name="renderer"]').forEach((input) => {
    input.addEventListener('change', handleRendererChange);
  });

  // Set up track checkboxes - add event listeners
  document.querySelectorAll('input[id^="track-"]').forEach((checkbox) => {
    checkbox.addEventListener('change', handleTrackChange);
  });

  document.getElementById('play').addEventListener('click', async () => {
    if (g_state.player) {
      try {
        g_state.player.play();
      } catch (error) {
        console.error('Error calling player.play():', error);
      }
    }
  });
  document.getElementById('pause').addEventListener('click', async () => {
    g_state.player?.pause();
  });
  document.getElementById('rewind').addEventListener('click', async () => {
    g_state.player?.rewind();
  });

  // Playlist navigation buttons
  document.getElementById('prev').addEventListener('click', async () => {
    await playPreviousSong();
  });

  document.getElementById('next').addEventListener('click', async () => {
    await playNextSong();
  });

  document.getElementById('upload').addEventListener('change', (e) => {
    // Auto-select the upload radio button when file is selected
    if (e.target.files.length > 0) {
      g_state.pendingSettings.musicSource = 'upload';
      g_state.pendingSettings.uploadFiles = Array.from(e.target.files);
      document.getElementById('source-upload').checked = true;
    }
  });
  document.getElementById('samples').addEventListener('change', (e) => {
    // Update pending settings when sample changes
    if (g_state.pendingSettings) {
      g_state.pendingSettings.sampleValue = e.target.value;
      g_state.pendingSettings.musicSource = 'samples';
      // Auto-select the samples radio button
      document.getElementById('source-samples').checked = true;
    } else {
      handleSampleSelect(e);
    }
  });
  document.getElementById('ireal').addEventListener('change', (e) => {
    // Update pending settings when URL changes
    if (g_state.pendingSettings) {
      g_state.pendingSettings.urlValue = e.target.value;
      g_state.pendingSettings.musicSource = 'url';
      // Auto-select the URL radio button
      document.getElementById('source-url').checked = true;
    } else {
      handleIRealChange(e);
    }
  });
  // Also auto-select URL radio on input (typing/pasting)
  document.getElementById('ireal').addEventListener('input', (e) => {
    if (e.target.value.trim()) {
      if (g_state.pendingSettings) {
        g_state.pendingSettings.urlValue = e.target.value;
        g_state.pendingSettings.musicSource = 'url';
      }
      document.getElementById('source-url').checked = true;
    }
  });
  document
    .getElementById('velocity')
    .addEventListener('change', handleVelocityChange);
  document
    .getElementById('repeat')
    .addEventListener('change', handleRepeatChange);
  document
    .getElementById('transpose')
    .addEventListener('change', handleTransposeChange);

  // Playlist selection
  document.getElementById('active-playlist').addEventListener('change', (e) => {
    // Update pending settings when playlist changes
    if (g_state.pendingSettings) {
      g_state.pendingSettings.playlistId = e.target.value;
      g_state.pendingSettings.musicSource = 'playlist';
      // Auto-select the playlist radio button
      document.getElementById('source-playlist').checked = true;
    } else {
      handlePlaylistChange(e);
    }
  });

  document.querySelectorAll('.option').forEach((element) => {
    if (!!g_state.options[element.id.replace('option-', '')]) {
      element.checked = true;
    }
    element.addEventListener('change', handleOptionChange);
  });
  // Initialize and add listener for respect-line-breaks checkbox
  const respectLineBreaksCheckbox = document.getElementById(
    'respect-line-breaks',
  );
  respectLineBreaksCheckbox.checked = g_state.options.respectLineBreaks;
  respectLineBreaksCheckbox.addEventListener('change', handleOptionChange);

  // Initialize and add listener for show-measure-numbers checkbox
  const showMeasureNumbersCheckbox = document.getElementById(
    'show-measure-numbers',
  );
  showMeasureNumbersCheckbox.checked =
    g_state.options.showMeasureNumbers ?? false;
  showMeasureNumbersCheckbox.addEventListener('change', handleOptionChange);

  window.addEventListener('keydown', handlePlayPauseKey);

  // Settings modal controls
  const settingsModal = document.getElementById('settings-modal');
  const settingsBtn = document.getElementById('settings-btn');
  const applySettings = document.getElementById('apply-settings');
  const cancelSettings = document.getElementById('cancel-settings');

  settingsBtn.addEventListener('click', () => {
    handleSettingsOpen();
    settingsModal.classList.add('show');
  });

  applySettings.addEventListener('click', () => {
    handleApplySettings();
  });

  cancelSettings.addEventListener('click', () => {
    handleCancelSettings();
  });

  // Close modal when clicking outside the content
  settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) {
      handleCancelSettings();
    }
  });

  // Music source radio buttons
  document.querySelectorAll('input[name="music-source"]').forEach((radio) => {
    radio.addEventListener('change', handleMusicSourceChange);
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
    navigator.serviceWorker
      .register('/service-worker.js')
      .then((registration) => {
        console.log(
          'Service Worker registered successfully:',
          registration.scope,
        );
      })
      .catch((error) => {
        console.log('Service Worker registration failed:', error);
      });
  }

  // Start the app.
  await handleSampleSelect({
    target: { value: g_state.params.get('sheet') ?? DEFAULT_SHEET },
  });
});
