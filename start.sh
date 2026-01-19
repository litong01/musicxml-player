#!/bin/bash
set -e  # Exit on any error

echo "🧹 Cleaning old builds..."
rm -rf build/
rm -rf demo/build/musicxml-player.*
rm -rf demo/build/spessasynth_processor.*

echo "🔨 Building library..."
npm run build

echo "📦 Copying build artifacts to demo/build/..."
cp -v build/musicxml-player.* demo/build/
cp -v build/spessasynth_processor.* demo/build/ 2>/dev/null || true

echo "🔄 Syncing to native platforms..."
npm run cap:sync

echo "📱 Opening Xcode..."
npm run cap:ios