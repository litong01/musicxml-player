#!/bin/bash
docker build -t tli551/mxp:0.0.2 .

docker rm -f tongli || true

docker run -d \
  --name tongli \
  -p 8082:8082 \
  -e KINDE_CLIENT_ID="fcb05db8b435460bb6e266ad6639e420" \
  -e KINDE_DOMAIN="https://tempoaide.kinde.com" \
  -e KINDE_AUDIENCE="" \
  tli551/mxp:0.0.2
