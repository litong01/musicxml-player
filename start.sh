#!/bin/bash
# Start the build process and copy files to the iOS app directory and start app and XCode
npm run build && \
cp demo/demo.mjs demo/build/demo.mjs && \
cp demo/index.html ios/App/App/public/index.html && \
cp demo/build/demo.mjs ios/App/App/public/demo.mjs && \
cp -r build/* ios/App/App/public/ && \
npm run cap:ios