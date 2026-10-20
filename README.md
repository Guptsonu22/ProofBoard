# ProofBoard

ProofBoard is a CSV report builder that profiles uploaded data, evaluates report blocks on the server, shows calculation provenance, and shares read-only report snapshots.

## Features and stack

- User registration and sign-in with bcrypt password hashes, HTTP-only sessions stored in SQLite, same-origin write protection, and per-user resource authorization.
- Server-side CSV parsing, type inference, quality profiling, row preview, and warnings.
- Persistent reports with metric, chart, top-N table, and plain-text note blocks; shared report filters and calculation proofs.
- Hashed share tokens, immutable evaluated snapshots, expiry, and revocation.
- React 19, TypeScript, Vite, Tailwind CSS, React Router, Recharts; Node.js, Express, Prisma, SQLite, Zod, Vitest, and Supertest.

## Prerequisites

- Node.js 20.19 or newer and npm 10 or newer.
- PowerShell on Windows.

## Windows PowerShell setup

Run these commands from the repository root. The migrations use `file:./dev.db`, resolved relative to `server/prisma/schema.prisma`; SQLite needs the empty database file to exist before Prisma migration commands run.

```powershell
Copy-Item .env.example server/.env
npm install
npm run db:generate
if (-not (Test-Path server/prisma/dev.db)) { New-Item -ItemType File -Path server/prisma/dev.db | Out-Null }
npm run db:migrate
npm run dev
```

Open <http://localhost:5173>. The API listens on port 4000 by default. Check it in another PowerShell window:

```powershell
Invoke-RestMethod http://127.0.0.1:4000/api/health
```

`server/.env` is ignored by Git. The example secret is only a local placeholder. Before production, set a unique random `SESSION_SECRET` of at least 32 characters, set `NODE_ENV=production`, and configure `CLIENT_ORIGIN`, `DATABASE_URL`, and a TLS-terminating reverse proxy for the deployed environment.

To build and run the production server after building:

```powershell
npm run build
npm start
```

The server serves `client/dist` when `NODE_ENV=production`.

## Try an upload

Create a small CSV in PowerShell, start the app, register an account, and upload `sample-sales.csv` from the upload screen:

```powershell
@'
order_date,region,revenue
2026-01-01,North,120
2026-01-02,South,80
2026-01-03,North,40
'@ | Set-Content -Encoding utf8 sample-sales.csv
```

The parser removes a UTF-8 BOM if PowerShell writes one. The repository also includes `server/src/reports/fixtures/sample-sales.csv` for calculation examples.

## Tests and verified results

From the repository root:

```powershell
npm test
npm run build
```

The final verified run completed with **34 server tests passing across 6 test files** and a successful production build of both server and frontend. Vite reported that the main client bundle exceeds its 500 kB advisory threshold. There is no separate frontend test script or browser end-to-end suite configured. The server test script resets `server/prisma/test.db`; it does not reset the development database.

For an empty local database, migrations were verified using the setup commands above. A read-only `prisma migrate status` check on the existing workspace `server/prisma/dev.db` found that its database-only migration is `20261019200000_init`, which is absent from the checked-in migration directory; Prisma reported no common migration between the two histories. `prisma migrate dev` can fail with `P3006` on this file. Do not reset or delete it. Before reconciling, stop the app, make a verified SQLite backup, compare the live schema and data with the checked-in migrations, and plan a data-preserving baseline or migration-history reconciliation on a copy first. A new empty database successfully applies all checked-in migrations.

## How my report builder works

### A. CSV ingestion

The authenticated upload route accepts one multipart file, with a default 5 MiB upload cap. The parser also limits input to 50,000 source records, 100 columns, and 256,000 characters per record. It decodes UTF-8 strictly, removes a BOM, and uses `csv-parse` for quoted commas, escaped quotes, and multiline fields. Binary/control-byte input, invalid UTF-8, empty input, and unrecoverable quoting produce actionable errors.

Column IDs are stable internal names such as `column_1`; original headers, display names, inferred types, rationale, and profile samples are stored as dataset metadata. Inference is conservative but heuristic: ISO dates need broad consistency; numeric columns need mostly numeric values or a numeric-looking header plus sufficient numeric samples. Headers suggesting measures (for example, `revenue` or `quantity`) help distinguish measures from IDs. ID-like headers, leading zeroes, and mostly unique long integers are treated as identifiers/categories. Low-cardinality text becomes category; remaining values stay text. These clues can still infer a type incorrectly, so a guessed type is not a data contract.

Blank cells remain valid parsed records and count as missing values. A valid record with an invalid typed cell gets a warning and remains stored. Recoverable malformed records and field-count mismatches are preserved as rejected row records with source row/line and reason. The response and profile distinguish source record, parsed, and rejected counts. Unrecoverable CSV syntax cannot be safely split into records, so the upload is rejected with a parser error instead of pretending those records were recovered. Values are stored as JSON strings and displayed as text; formulas are never evaluated, and the original file is not retained.

### B. Calculation flow

The upload parser stores row values and metadata in `Dataset`/`DatasetRow`. When a report is evaluated, the server first loads the report and dataset using the user ID from the validated session, then loads that owner's rows by dataset ID in source order. Requested stable column IDs resolve against the dataset's stored column metadata. Zod validates the report definition; the evaluator checks operation and column types before applying date and category filters, then computes metrics, chart series, or ranked table rows in memory.

For example, a `revenue` sum starts with the stored cell strings, applies the same report filters used for the other blocks, parses only valid finite numbers, and sums those numbers on the server. The API returns the value and its provenance together; React renders that returned value and does not recalculate it. The proof includes operation and selected columns, filter configuration, the algorithm description and parameters, included/excluded counts, reasons, and null/invalid policy. It truthfully identifies an in-memory calculation: Prisma ORM loads owner-scoped rows; no SQL aggregation is executed.

For metric/chart blocks, blank and invalid measure values are excluded, never converted to zero. Numeric aggregations require an inferred numeric column; `count` counts valid nonblank values. Duplicate records are separate observations, and negative values remain valid. Missing group keys, chart dimensions, and table sort values are excluded with reasons. Report-filter exclusions and ingestion-rejected records are also accounted for in provenance. Top-N ranking reports records outside the limit separately; rank is distinct from original source row number. A note has no data calculation. If a definition or numeric range is unsupported, evaluation returns an error rather than invented output.

### C. Sharing and security

Creating a share uses 32 random bytes encoded as base64url. Only the SHA-256 token hash is stored; the raw token is returned to the owner to form the public URL. At creation, the server saves a snapshot of the report definition, evaluated results, and provenance, omitting internal owner/dataset/report identifiers and raw CSV access. Top-N table snapshots include every dataset column for each displayed row; the share dialog warns owners to review these values before creating a link. Later edits to the private report do not change that snapshot.

Each public request hashes and validates its token and checks expiry and revocation against the database. Revocation takes effect on the next request. Public responses are read-only and sent with no-store cache controls and a no-referrer policy. The public route exposes only the snapshot; private dataset/report routes require a session and scope database queries to that session's user. Composite foreign keys also bind dataset rows and reports/shares to their owner. Password hashes and token hashes are not returned by API responses.

### D. Remaining risks and scale

The upload is held in memory, parsed into arrays, then inserted in batches; evaluation loads rows into memory and processes them in JavaScript. A CSV 100 times larger exceeds the current upload/row limits long before it can be evaluated. If limits were raised without redesign, memory use and SQLite write/read latency would become the first failures. The next scale step would be streaming parsing into bounded batches, moving to a server database, and evaluating typed values incrementally or through safe allowlisted query plans. The in-memory login/share rate limits are per process and reset at restart; production multi-instance deployments need a shared limiter store. Production responses set a Content Security Policy with self-hosted scripts and no objects or frames; inline styles remain allowed for UI progress styling. The Vite development server does not attach that policy to its HTML. The client bundle currently exceeds Vite's advisory chunk size.

## Decisions and trade-offs

- SQLite and one npm-workspace repository keep local setup small; SQLite is suited to this take-home scale, not high-write multi-instance use.
- Dataset cells remain bounded raw strings in JSON so previews preserve source text. Typed values are validated at evaluation time rather than silently rewriting source data.
- The evaluator uses in-memory operations and provides an explicit structured plan and row accounting. This is easier to audit for the supported limits, but it loads rows into the application process.
- Shared links snapshot results at creation so the public view remains stable even when the owner edits the source report.

## What was cut for time

- CSV export and import formats beyond CSV.
- Password recovery and email verification.
- A separately configured frontend unit-test suite and automated browser end-to-end tests.
- Streaming ingestion and database-backed distributed rate limiting.

## Actual hours spent

## How AI was used

AI assistance was used to inspect the implementation, edit code and documentation, add/adjust tests, and run the test/build commands. One concrete AI error occurred while adding overflow protection to aggregation: the first version scaled every sum, which changed ordinary floating-point outputs and failed existing exact-value tests. The failing Vitest run exposed it. The implementation was corrected to preserve the existing arithmetic for normal magnitudes and scale only near overflow (`server/src/reports/evaluate.ts`); the full server suite then passed with all 34 tests across 6 test files.

