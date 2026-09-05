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
ARG VITE_CLERK_PUBLISHABLE_KEY
ARG CLERK_PUBLISHABLE_KEY

ENV PORT=$PORT
ENV BASE_PATH=/
ENV NODE_ENV=production
ENV STORAGE_DIR=/data/uploads

# Make Clerk's frontend key available during the Vite build.
# Railway should define VITE_CLERK_PUBLISHABLE_KEY as a build variable.
ENV VITE_CLERK_PUBLISHABLE_KEY=$VITE_CLERK_PUBLISHABLE_KEY
ENV CLERK_PUBLISHABLE_KEY=$CLERK_PUBLISHABLE_KEY

RUN pnpm install --no-frozen-lockfile
RUN pnpm build

RUN mkdir -p /data/uploads
EXPOSE 3000

CMD ["pnpm", "start"]
