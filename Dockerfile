FROM node:22-alpine
ENV NODE_ENV=production DATA_DIR=/data PORT=3000
WORKDIR /app
COPY index.html ./
COPY web ./web
COPY server ./server
 && mkdir -p /data && chown node:node /data
USER node
WORKDIR /app/server
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -q -O - http://127.0.0.1:3000/api/health >/dev/null || exit 1
CMD ["node", "--disable-warning=ExperimentalWarning", "src/index.js"]
