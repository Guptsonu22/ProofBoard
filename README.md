# ProofBoard

ProofBoard is a CSV report builder. The current phase provides account registration and login, persistent server-side sessions, owner-scoped dataset and report metadata routes, and a secure empty workspace. CSV parsing and report calculations are not implemented yet; the dashboard does not show fabricated data.

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

The server test command resets only the ignored `server/prisma/test.db`, applies all migrations there, and runs integration tests. It covers health and error responses, registration, login, logout, SQLite-backed session persistence, CSRF rejection, cookie attributes, and access isolation between two users.

## Environment variables

Copy `.env.example` to `server/.env` for local use. `PORT`, `CLIENT_ORIGIN`, `DATABASE_URL`, and `SESSION_SECRET` are parsed and validated at server startup. Browser writes must include the configured same origin; the server also rejects cross-site Fetch Metadata. Passwords are bcrypt hashed, login and registration are rate limited, and session IDs are stored in SQLite. The browser does not store authentication tokens in localStorage. Do not commit `.env` or use local database files in production.

## Structure

```text
client/                 React, TypeScript, Vite, Tailwind, Router, Recharts
  src/lib/               API client
  src/                   Application shell and styles
server/                  Express, TypeScript, Prisma, SQLite
  prisma/                Database schema and migrations
  src/auth/               Session store, auth, CSRF and auth routes
  src/resources/          Owner-scoped dataset and report metadata routes
  src/config/             Validated environment configuration
  src/lib/                Errors and request validation
  src/                    HTTP app and server entry point
```
