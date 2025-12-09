MusicXML Player
===============

[![npm](https://img.shields.io/npm/v/%40music-i18n%2Fmusicxml-player)](https://www.npmjs.com/package/@music-i18n/musicxml-player)
[![build](https://github.com/litong01/musicxml-player/actions/workflows/multi-arch-image.yaml/badge.svg?branch=main)](https://github.com/litong01/musicxml-player/actions/workflows/multi-arch-image.yaml)

A TypeScript component that loads and plays MusicXML files in the browser using Web Audio and Web MIDI.

![Screenshot](main.png?raw=true)
![Screenshot](setting.png?raw=true)

# Getting started
```
./build.sh
docker run -d --name musicxml-player -p 8082:8082 tli551/mxp:0.0.1
```
Then open http://127.0.0.1:8082/


# Theory of operation
This component synchronizes rendering and playback of MusicXML scores. Rendering is done using existing Web-based music engraving libraries such as [Verovio](https://github.com/rism-digital/verovio) or [OpenSheetMusicDisplay](https://github.com/opensheetmusicdisplay/opensheetmusicdisplay). Rendering can also use pre-rendered assets (SVG, metadata) obtained from MuseScore or Verovio. Playback uses standard MIDI files that are expected to correspond to the given MusicXML, and sends the MIDI events to either a Web MIDI output, or to a Web Audio synthesizer, using the module [`spessasynth_lib`](https://github.com/spessasus/spessasynth_lib).

The crucial part of this functionality is to synchronize the measures and beats in the MusicXML file with the events of the MIDI file. In a nutshell, the player expects the provider of the MIDI file (an implementation of `IMidiConverter`) to supply a "timemap", which associates each measure in the MusicXML file to a timestamp at which this measure occurs. In the case of repeats and jumps, the same measure will be referenced several times in the timemap.

There are 3 bundled implementations of `IMidiConverter` in this module:
- An API client that connects to the [`musicxml-midi`](https://github.com/infojunkie/musicxml-midi) API server. `musicxml-midi` is a converter whose major contribution is to generate a MIDI accompaniment in addition to the music in the MusicXML score.
- [Verovio](https://github.com/rism-digital/verovio), that generates a faithful rendition of the MusicXML score but lacks accompaniment generation.
- It is also possible to hand-craft the MIDI and timemap files, and instruct the player to read those explicitly.

# Try the application

[Musicxml-player](https://musicxml-player.onrender.com)

# Main capabilities:
- Play xml files from dropdown box
- Upload music xml file with match midi file or just xml file (midi gets generated automatically)
- Use url which points to music xml on the web
