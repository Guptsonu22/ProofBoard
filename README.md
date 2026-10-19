# ProofBoard

ProofBoard is a CSV report builder. It provides account registration and login, persistent server-side sessions, private CSV upload, data profiling, a row preview, and row-level quality warnings. Report calculations and sharing are later phases; the interface does not show fabricated report data.

## Requirements

- Node.js 20.19+ (Node 22 LTS recommended)
- npm 10+

## Setup in Windows PowerShell

From the project folder:

```powershell
Copy-Item .env.example server/.env
npm install
npm run db:generate
npm run db:migrate
```

The migrations create the local SQLite database. No seed data is needed; create an account from the sign-in screen.

**Migration status:** this workspace's development database records a Phase 2 baseline migration named `20261019200000_init`, while the checked-in history has older migration names. Prisma migration verification currently fails on that mismatch. The Phase 3 schema was synchronized to the local database with `prisma db push`, preserving its existing rows. Migration history needs reconciliation before `npm run db:migrate` can be relied on for a fresh or upgraded database.

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

`npm start` launches the production server and serves the built client from `client/dist`. Before production, set `NODE_ENV=production`, replace `SESSION_SECRET` with a unique random value of at least 32 characters, and set `CLIENT_ORIGIN` to the exact HTTPS origin serving the app. Production session cookies are Secure and require HTTPS.

## Tests

```powershell
npm test
```

The server test command resets only the ignored `server/prisma/test.db` with the current Prisma schema, then runs integration tests. It covers authentication, session persistence, CSV parsing and profiling, malformed and oversized inputs, data preservation, and cross-user access isolation.

## Environment variables

Copy `.env.example` to `server/.env` for local use. `PORT`, `CLIENT_ORIGIN`, `DATABASE_URL`, `SESSION_SECRET`, and `CSV_MAX_UPLOAD_BYTES` are parsed and validated at server startup. The upload limit defaults to 5 MB; CSVs are also limited to 50,000 source records and 100 columns. Browser writes must include the configured same origin; the server also rejects cross-site Fetch Metadata. Passwords are bcrypt hashed, login and registration are rate limited, and session IDs are stored in SQLite. The browser does not store authentication tokens in localStorage. Do not commit `.env` or use local database files in production.

## CSV inference

The server treats blank or whitespace-only cells as missing and keeps them in parsed rows. Numeric inference uses finite decimal values: a column needs at least 95% numeric samples, or a measure-like header and at least three numeric values covering 75% of samples. Date inference accepts ISO dates only: 90% of samples, or a date-like header with at least three valid samples covering 75%. Identifier-like headers, leading zeroes, and mostly unique integer columns stay categorical. Other low-cardinality columns are categorized when distinct values are at most the lower of 50 or 20% of non-empty values; remaining columns are text. Each column profile includes the reason the rule selected its type.

## Structure

```text
client/                 React, TypeScript, Vite, Tailwind, Router, Recharts
  src/lib/               API client
  src/datasets/          Dataset upload, list, profile, and preview UI
  src/                   Application shell and styles
server/                  Express, TypeScript, Prisma, SQLite
  prisma/                Database schema and migrations
  src/auth/               Session store, auth, CSRF and auth routes
  src/datasets/           CSV parser, inference, upload, and private preview APIs
  src/resources/          Owner-scoped dataset and report metadata routes
  src/config/             Validated environment configuration
  src/lib/                Errors and request validation
  src/                    HTTP app and server entry point
```
