# ProofBoard

ProofBoard is a CSV report builder. This phase provides the runnable React and Express foundation, a health endpoint, and an empty workspace state. Dataset upload, reports, authentication, and sharing will be implemented in later phases; the dashboard does not show fabricated reports or chart data.

## Requirements

- Node.js 20.19+ (Node 22 LTS recommended)
- npm 10+

## Setup in Windows PowerShell

From the project folder:

```powershell
Copy-Item .env.example .env
npm install
npm run db:generate
npm run db:migrate
```

The migration creates the local SQLite database. No seed data is needed in this phase.

## Run in development

```powershell
npm run dev
```

Open <http://localhost:5173>. The API listens on `http://127.0.0.1:4000`; Vite forwards `/api` requests to it. Confirm the API with:

```powershell
Invoke-RestMethod http://127.0.0.1:4000/api/health
```

## Build and run production output

```powershell
npm run build
npm start
```

Set `NODE_ENV=production` in `.env` before starting the production server so Express serves the built client. By default, `npm start` uses the configured development environment and only starts the API.

## Tests

```powershell
npm test
```

The server tests cover the health response and consistent not-found JSON error shape.

## Environment variables

Copy `.env.example` to `.env` for local use. `PORT`, `CLIENT_ORIGIN`, and `DATABASE_URL` are parsed and validated at server startup. Do not commit `.env` or use local database files in production.

## Structure

```text
client/                 React, TypeScript, Vite, Tailwind, Router, Recharts
  src/lib/               API client
  src/                   Application shell and styles
server/                  Express, TypeScript, Prisma, SQLite
  prisma/                Database schema and migrations
  src/config/            Validated environment configuration
  src/lib/               Errors and request validation
  src/                   HTTP app and server entry point
```
