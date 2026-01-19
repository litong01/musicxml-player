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

// Suppress Verovio font loading warnings that are expected in web environments
// These warnings occur because Verovio expects additional font files that aren't
// needed for basic functionality - the WASM module includes embedded fallback fonts
const originalError = console.error;
console.error = function (...args) {
  const message = args.join(' ');
  // Suppress expected Verovio font warnings
  if (message.includes('SMuFL glyphs') || message.includes('Leipzig font')) {
    // These warnings are expected when running in a browser environment
    // Verovio's embedded fonts provide sufficient coverage for most use cases
    return; // Silently ignore
  }
  originalError.apply(console, args);
};

// List of CORS proxies to try in order (only used for web, not native apps)
const CORS_PROXIES = [
  '/proxy?url=', // Our own backend proxy (most reliable)
  'https://corsproxy.io/?',
  'https://api.allorigins.win/raw?url=',
];

/**
 * Convert Google Drive share URLs to direct download URLs
 * Uses the format that bypasses virus scan warnings for larger files
 */
function convertGoogleDriveUrl(url) {
  const match = url.match(/drive\.google\.com\/file\/d\/([^\/]+)/);
  if (match) {
    const fileId = match[1];
    // Use confirm=t to bypass the "Google can't scan this file for viruses" warning
    // This format works more reliably for files of all sizes
    return `https://drive.google.com/uc?export=download&confirm=t&id=${fileId}`;
  }
  return url;
}

/**
 * Convert Dropbox share URLs to direct download URLs
 */
function convertDropboxUrl(url) {
  // Change dl=0 to dl=1 for direct download
  if (url.includes('dropbox.com') && url.includes('dl=0')) {
    return url.replace('dl=0', 'dl=1');
  }
  // If no dl parameter, add dl=1
  if (url.includes('dropbox.com') && !url.includes('dl=')) {
    const separator = url.includes('?') ? '&' : '?';
    return url + separator + 'dl=1';
  }
  return url;
}

/**
 * Convert OneDrive share URLs to direct download URLs
 */
function convertOneDriveUrl(url) {
  // OneDrive/1drv.ms links - add download=1 parameter
  if (url.includes('onedrive.live.com') || url.includes('1drv.ms')) {
    const separator = url.includes('?') ? '&' : '?';
    return url + separator + 'download=1';
  }
  return url;
}

/**
 * Convert all supported cloud storage URLs to direct download format
 */
function convertToDirectDownload(url) {
  let convertedUrl = url;
  convertedUrl = convertGoogleDriveUrl(convertedUrl);
  convertedUrl = convertDropboxUrl(convertedUrl);
  convertedUrl = convertOneDriveUrl(convertedUrl);
  return convertedUrl;
}

/**
 * Fetch a file from an external URL.
 * In native apps (Capacitor), use CapacitorHttp for better native networking.
 * In web apps, use proxy to handle CORS.
 */
async function fetchExternalUrl(url) {
  // Native app: use CapacitorHttp from @capacitor/core for native networking
  const { CapacitorHttp } = window.Capacitor.Plugins;
  const directUrl = convertToDirectDownload(url);
  if (directUrl !== url) {
  }
  
  try {
    
    const options = {
      url: directUrl,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15',
        'Accept': '*/*',
      },
      responseType: 'arraybuffer',
      readTimeout: 30000,
      connectTimeout: 30000,
    };
    
    const response = await CapacitorHttp.get(options);
    
      
      if (response.status >= 200 && response.status < 300) {
        const contentType = response.headers['content-type'] || response.headers['Content-Type'];
        
        // Check if we got an HTML page instead of a file
        if (contentType && contentType.includes('text/html')) {
          console.warn('[Native App] Received HTML instead of file');
          const htmlText = typeof response.data === 'string' ? response.data : new TextDecoder().decode(response.data);
          throw new Error('Received HTML page instead of file. Google Drive may require authentication or the file may not be publicly accessible. Try using "Anyone with the link" sharing setting.');
        }
        
        // CapacitorHttp returns base64 encoded string when responseType is 'arraybuffer'
        // We need to decode it to ArrayBuffer
        let buffer;
        if (typeof response.data === 'string') {
          // Decode base64 to ArrayBuffer
          const binaryString = atob(response.data);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          buffer = bytes.buffer;
        } else {
          buffer = response.data;
        }
        
        return buffer;
      }
      
      const errorText = typeof response.data === 'string' ? response.data : new TextDecoder().decode(response.data);
      console.error(`[Native App] Error response (first 500 chars): ${errorText.substring(0, 500)}`);
      throw new Error(`HTTP ${response.status}`);
      
    } catch (error) {
      console.error(`[Native App] CapacitorHttp error:`, error);
      console.error(`[Native App] Error name:`, error.name);
      console.error(`[Native App] Error message:`, error.message);
      
      if (error.stack) {
        console.error(`[Native App] Error stack:`, error.stack);
      }
      
      if (error.name === 'Timeout' || error.message?.includes('timeout')) {
        throw new Error('Request timed out after 30 seconds');
      }
      
      // Provide helpful error message
      if (error.message === 'Load failed') {
        throw new Error('Network request blocked. Please delete the app from the simulator (long press → Delete App) and rebuild to apply security settings.');
      }
      
      throw new Error(`Unable to fetch from ${url}: ${error.message || 'Network error'}`);
    }
}

const DEFAULT_OPTIONS = {
  unroll: false,
  horizontal: false,
  follow: true,
  mute: false,
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
    metronome: false,
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

  // Reset play/pause button to play icon for new piece
  const playPauseBtn = document.getElementById('play-pause');
  if (playPauseBtn) {
    playPauseBtn.textContent = '▶';
  }

  // Set the player parameters.
  const sheet = g_state.params.get('sheet');
  const output = g_state.params.get('output') ?? DEFAULT_OUTPUT;
  let renderer = g_state.params.get('renderer') ?? DEFAULT_RENDERER;
  const groove = g_state.params.get('groove') ?? DEFAULT_GROOVE;
  const velocity = g_state.params.get('velocity') ?? DEFAULT_VELOCITY;
  const repeat = g_state.params.get('repeat') ?? DEFAULT_REPEAT;
  const transpose = g_state.params.get('transpose') ?? DEFAULT_TRANSPOSE;
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
        renderer = DEFAULT_RENDERER;
      }
    }
  }
  document.getElementById(`renderer-${renderer}`).checked = true;

  // Always use AccompanimentConverter for native apps (handles all track combinations, transpose, and metronome)
  const converter = 'accomp';

  // Create new player.
  if (g_state.musicXml) {
    try {
      
      const converterInstance = await createConverter(
        converter,
        sheet,
        groove,
        renderer,
        options,
      );

      const player = await Player.create({
        musicXml: g_state.musicXml,
        container: 'sheet-container',
        renderer: await createRenderer(renderer, sheet, options),
        output: undefined, // Always use local synth
        converter: converterInstance,
        unroll: options.unroll, // For rendering - user controls whether to show repeats
        mute: options.mute,
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

      // Ensure sheet container is visible (important for WebView environments)
      const container = document.getElementById('sheet-container');
      if (container) {
        container.style.display = 'block';
        container.style.visibility = 'visible';
        container.style.opacity = '1';
      }
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

async function createConverter(converter, sheet, groove, renderer, options) {
  const base =
    sheet.startsWith('http') || sheet.startsWith('data/')
      ? sheet
      : `data/${sheet}`;

  // Extract base filename for cache lookup
  let baseName = sheet.replace(/\.(musicxml|mxl|xml)$/i, '');
  if (baseName.startsWith('data/')) {
    baseName = baseName.replace(/^data\//, '');
  }

  // Use AccompanimentConverter to generate band accompaniment with selected tracks
  return new AccompanimentConverter({
    bandEnergy: 'medium',
    solo: g_state.tracks.solo,
    piano: g_state.tracks.piano,
    bass: g_state.tracks.bass,
    strings: g_state.tracks.strings,
    drums: g_state.tracks.drums,
    metronome: g_state.tracks.metronome,
    drummerPracticeMode: true,
  });
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
  document.getElementById('track-metronome').checked = g_state.tracks.metronome;

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
    settings.tracks.drums !== g_state.tracks.drums ||
    settings.tracks.metronome !== g_state.tracks.metronome;

  // Check if any renderer options changed (these require reload)
  const currentOptions = g_state.options;
  const respectLineBreaksChanged =
    settings.options.respectLineBreaks !== currentOptions.respectLineBreaks;
  const showMeasureNumbersChanged =
    settings.options.showMeasureNumbers !== currentOptions.showMeasureNumbers;
  const renderOptionsChanged =
    respectLineBreaksChanged || showMeasureNumbersChanged;

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
    const playPauseBtn = document.getElementById('play-pause');
    if (g_state.player.state === PLAYER_PLAYING) {
      g_state.player.pause();
      playPauseBtn.textContent = '▶';
    } else {
      g_state.player.play();
      playPauseBtn.textContent = '⏸';
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
  if (!e.target.value) {
    return;
  }

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
    try {
      const response = await fetish(sheet);
      const buffer = await response.arrayBuffer();
      const filename = sheet.split('/').pop();
      await handleFileBuffer(filename, buffer);
    } catch (error) {
      console.error('Error loading file:', error);
      alert('Failed to load file: ' + sheet + '\nError: ' + error.message);
    }
    return;
  }

  // Clear playlist state when manually selecting a sample
  clearPlaylistState();

  try {
    // Renderer and converter are determined by settings and auto-detection, not per-file
    if (sheet.endsWith('.musicxml') || sheet.endsWith('.mxl')) {
      // Fetch the MusicXML file
      const response = await fetish(sheet);
      const buffer = await response.arrayBuffer();

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
    console.error('Error in handleSampleSelect:', error);
    alert('Failed to load music file: ' + error.message);
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

    // Only delete cache if user didn't provide MIDI file
    if (!skipCacheDelete) {
      await deleteMidiFile(baseName);
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

  // Set up monitoring for any player (not just playlist mode)
  if (!g_state.player) {
    return;
  }

  wasPlaying = false;
  let lastPlayerState = null; // Track previous player state

  // Monitor playback state
  playbackMonitorInterval = setInterval(() => {
    if (!g_state.player) {
      clearInterval(playbackMonitorInterval);
      playbackMonitorInterval = null;
      return;
    }

    const isPlaying = g_state.player.state === PLAYER_PLAYING;
    const position = g_state.player.position;
    const duration = g_state.player.duration;

    // When playing and position reaches duration, the player doesn't auto-pause
    // We need to detect this and pause manually
    if (isPlaying && duration > 0 && position >= duration - 1) {
      g_state.player.pause();
      g_state.player.rewind();

      // Update button immediately
      const playPauseBtn = document.getElementById('play-pause');
      if (playPauseBtn) {
        playPauseBtn.textContent = '▶';
      }
      return; // Skip rest of this iteration
    }

    // Track current state for next iteration
    lastPlayerState = g_state.player.state;

    // Update play/pause button to match current state
    const playPauseBtn = document.getElementById('play-pause');
    if (playPauseBtn) {
      const currentIcon = playPauseBtn.textContent;
      const expectedIcon = isPlaying ? '⏸' : '▶';
      if (currentIcon !== expectedIcon) {
        playPauseBtn.textContent = expectedIcon;
      }
    }

    // Detect when playback stops after being in playing state
    // Check if we're within 100ms of the end
    if (
      wasPlaying &&
      !isPlaying &&
      duration > 0 &&
      position >= duration - 0.1
    ) {
      wasPlaying = false;

      // Auto-advance to next song only if in playlist mode
      if (g_state.currentPlaylist) {
        if (
          g_state.currentSongIndex <
          g_state.currentPlaylist.urls.length - 1
        ) {
          playNextSong();
        } else {
          updatePlaylistDisplay();
        }
      } else {
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
  // Skip auth entirely if disabled
  if (!authManager.authEnabled) {
    return;
  }

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

    // Listen for auth callback completion to re-initialize the entire app
    window.addEventListener('auth-callback-complete', async (event) => {
      // Update UI first
      updateAuthUI();

      // Force complete re-initialization after successful login
      // Wait a bit to ensure DOM is stable
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Re-populate samples and playlists
      await populateSamplesList();
      populatePlaylistDropdown();

      // Force re-create the player with default or stored settings
      const defaultSheet = g_state.params.get('sheet') || DEFAULT_SHEET;

      // Trigger a fresh player creation
      await handleSampleSelect({ target: { value: defaultSheet } });

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


// Function containing all initialization code
async function initializeApp() {
  
  // Initialize authentication (skips if disabled)
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
        metronome: false,
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

  // Play/Pause toggle button
  const playPauseBtn = document.getElementById('play-pause');
  playPauseBtn.addEventListener('click', async () => {
    if (g_state.player) {
      try {
        // Check the actual player state, not our cached state
        if (g_state.player.state === PLAYER_PLAYING) {
          g_state.player.pause();
          playPauseBtn.textContent = '▶';
        } else {
          g_state.player.play();
          playPauseBtn.textContent = '⏸';
        }
      } catch (error) {
        console.error('Error toggling play/pause:', error);
      }
    }
  });
  document.getElementById('rewind').addEventListener('click', async () => {
    g_state.player?.rewind();
    // Reset to play icon since rewinding pauses
    const playPauseBtn = document.getElementById('play-pause');
    if (playPauseBtn) {
      playPauseBtn.textContent = '▶';
    }
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

  // Transpose increment/decrement buttons
  const transposeDecrease = document.getElementById('transpose-decrease');
  const transposeIncrease = document.getElementById('transpose-increase');
  const velocityDecrease = document.getElementById('velocity-decrease');
  const velocityIncrease = document.getElementById('velocity-increase');

  const handleTransposeDecrease = (e) => {
    e.preventDefault();
    const input = document.getElementById('transpose');
    const currentValue = parseFloat(input.value) || 0;
    const min = parseFloat(input.min);
    const step = parseFloat(input.step) || 1;
    const newValue = Math.max(min, currentValue - step);
    input.value = newValue;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };

  const handleTransposeIncrease = (e) => {
    e.preventDefault();
    const input = document.getElementById('transpose');
    const currentValue = parseFloat(input.value) || 0;
    const max = parseFloat(input.max);
    const step = parseFloat(input.step) || 1;
    const newValue = Math.min(max, currentValue + step);
    input.value = newValue;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };

  const handleVelocityDecrease = (e) => {
    e.preventDefault();
    const input = document.getElementById('velocity');
    const currentValue = parseFloat(input.value) || 1;
    const min = parseFloat(input.min);
    const step = parseFloat(input.step) || 0.25;
    const newValue = Math.max(min, currentValue - step);
    input.value = newValue;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };

  const handleVelocityIncrease = (e) => {
    e.preventDefault();
    const input = document.getElementById('velocity');
    const currentValue = parseFloat(input.value) || 1;
    const max = parseFloat(input.max);
    const step = parseFloat(input.step) || 0.25;
    const newValue = Math.min(max, currentValue + step);
    input.value = newValue;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };

  // Add both click and touchend listeners for mobile support
  transposeDecrease.addEventListener('click', handleTransposeDecrease);
  transposeDecrease.addEventListener('touchend', handleTransposeDecrease);
  transposeIncrease.addEventListener('click', handleTransposeIncrease);
  transposeIncrease.addEventListener('touchend', handleTransposeIncrease);
  velocityDecrease.addEventListener('click', handleVelocityDecrease);
  velocityDecrease.addEventListener('touchend', handleVelocityDecrease);
  velocityIncrease.addEventListener('click', handleVelocityIncrease);
  velocityIncrease.addEventListener('touchend', handleVelocityIncrease);

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

  // Service worker is not needed for Capacitor native apps
  // Skip registration in native environment
  if ('serviceWorker' in navigator && !window.Capacitor) {
    navigator.serviceWorker
      .register('/service-worker.js')
      .then((registration) => {
      })
      .catch((error) => {
      });
  }

  // Start the app.
  try {
    await handleSampleSelect({
      target: { value: g_state.params.get('sheet') ?? DEFAULT_SHEET },
    });
  } catch (error) {
    console.error('Failed to start app:', error);
    alert('Failed to load music: ' + error.message);
  }
}

// Run initialization when DOM is ready or immediately if already ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeApp);
} else {
  initializeApp();
}
