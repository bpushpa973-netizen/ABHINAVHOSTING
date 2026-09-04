# Telegram Bot Hosting — GitHub → Railway

## Deploy
1. Upload the contents of this folder to the root of a GitHub repository.
2. In Railway, create a new project and choose **Deploy from GitHub Repo**.
3. Railway will use the included `Dockerfile` automatically.
4. Add a PostgreSQL service and make sure `DATABASE_URL` is available to the app.
5. Add Clerk variables: `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, and `VITE_CLERK_PUBLISHABLE_KEY`.
6. Add a Railway Volume mounted at `/data` so uploaded bot files survive restarts/deploys.
7. Deploy and open the generated Railway domain.

## Important
This project was originally configured for Replit object storage. The Railway version uses local storage at `/data/uploads` instead, so a Railway Volume is strongly recommended.

The app serves the React website and API from the same Railway service. Railway's `PORT` variable is used automatically.

## Database
After the PostgreSQL service is available, run `pnpm db:push` once if the schema has not been created yet. Railway's PostgreSQL connection URL should be used as `DATABASE_URL`.
