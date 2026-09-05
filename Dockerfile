FROM node:22-bookworm

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@10.4.1 --activate \
    && apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-venv python3-pip openjdk-17-jre-headless openjdk-17-jdk-headless \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY . .

ARG PORT=3000
ENV PORT=$PORT
ENV BASE_PATH=/
ENV NODE_ENV=production
ENV STORAGE_DIR=/data/uploads

RUN pnpm install --no-frozen-lockfile
RUN pnpm build

RUN mkdir -p /data/uploads
EXPOSE 3000

CMD ["pnpm", "start"]
