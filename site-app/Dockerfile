# The AI Assurance workspace as one self-hosted container.
#   docker compose up        (from the repository root)
# Data (database, evidence, secrets) lives in the /data volume; the first
# visit to http://localhost:8787 asks for the owner account.
FROM node:22-bookworm AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build && rm -rf data .wrangler

FROM node:22-bookworm-slim
# workerd loads the system CA certificates at start; the slim image has none.
COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
ENV HOST=0.0.0.0 \
    PORT=8787 \
    DATA_DIR=/data \
    WRANGLER_SEND_METRICS=false
WORKDIR /app
COPY --from=build --chown=node:node /app /app
RUN mkdir -p /data /app/.wrangler && chown node:node /data /app /app/.wrangler
USER node
VOLUME ["/data"]
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/auth/sign-in',{redirect:'manual'}).then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"
CMD ["node", "scripts/self-host.mjs"]
