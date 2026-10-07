FROM oven/bun:1-slim
WORKDIR /app
# The API has no runtime npm dependencies; only the shared core package is copied in.
COPY packages/core /app/packages/core
COPY server /app/server
RUN mkdir -p /app/node_modules/@darbna && ln -s /app/packages/core /app/node_modules/@darbna/core
WORKDIR /app/server
ENV NODE_ENV=production PORT=8080
USER bun
EXPOSE 8080
HEALTHCHECK CMD bun -e "fetch('http://localhost:8080/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["bun", "src/main.ts"]
