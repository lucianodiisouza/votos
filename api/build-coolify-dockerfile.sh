#!/bin/sh
# Gera Dockerfile.coolify: Dockerfile autocontido (server.js embutido em gzip+base64)
# pra colar no Coolify com o build pack "Dockerfile", sem precisar de repositório git.
set -e
cd "$(dirname "$0")"
V=$(node -p "require('./package-lock.json').packages['node_modules/web-push'].version")
B64=$(gzip -9c server.js | base64 | tr -d '\n')
cat > Dockerfile.coolify <<DOCKER
# Gerado por build-coolify-dockerfile.sh. Não edite à mão.
FROM node:20-alpine
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data
WORKDIR /app
RUN echo '{"type":"module","private":true}' > package.json && npm i --omit=dev web-push@$V && npm cache clean --force
RUN echo '$B64' | base64 -d | gunzip > server.js
RUN mkdir -p /data && chown -R node:node /data /app
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD wget -qO- http://127.0.0.1:3000/health || exit 1
CMD ["node", "server.js"]
DOCKER
echo "Dockerfile.coolify gerado ($(wc -c < Dockerfile.coolify) bytes)"
