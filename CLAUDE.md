# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project state

This is a Node.js/Express blog API using MySQL via Sequelize. It implements user auth (register/login/logout) under `/api/users` and post CRUD under `/api/posts` (create supports an optional `Idempotency-Key` header via `middleware/idempotency.js`). New resources should follow the existing layering described below.

The React + Vite frontend lives in a separate sibling repo, `../Blog-frontend`, and talks to this API over CORS.

## Commands

- `npm run dev` — start with nodemon (auto-reload), used for local development.
- `npm start` — start with plain `node server.js`.
- `npm test` — integration tests via node's built-in test runner + `supertest`, in `tests/`. Requires a `blog_db_test` MySQL database (`CREATE DATABASE blog_db_test;`); the script passes `DB_NAME=blog_db_test` inline, which wins over `.env` because `dotenv.config()` does not overwrite already-set vars. `--test-concurrency=1` is required, since `node --test` otherwise runs files in parallel processes that would reset the shared test database out from under each other.
- Tests set `NODE_ENV=test`, which makes the rate limiters in `middleware/rateLimiter.js` skip (5 logins / 15 min cannot support a suite, and the window does not reset between runs). The limiters themselves are therefore covered by manual `request.http` checks, not automated tests.
- `tests/helpers.js` resets state with `sequelize.sync()` + truncate rather than `sync({ force: true })`: dropping tables races the fire-and-forget `Model.sync()` calls the model files make at import time, which surfaces as "table doesn't exist" unhandled rejections.
- No lint config or CI currently exists in this repo.
- Ad-hoc endpoint testing is done via `request.http` (VS Code REST Client format).

## Environment

Config is loaded via `dotenv` from a `.env` file (see `server.js` and `database/dbconnection.js`). Required variables, inferred from usage in code:
- `PORT` — server port (defaults to 5000 if unset).
- `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_HOST`, `DB_PORT` (defaults to 3306) — MySQL connection details passed straight into `new Sequelize(...)`.
- `JWT_SECRET` — used to sign/verify JWTs in `services/userService.js` and `middleware/authMiddleware.js`.
- `CLIENT_ORIGIN` — comma-separated browser origins allowed by CORS in `app.js` (defaults to `http://localhost:5173`, the Vite dev server).

Keep `.env.example` in sync when adding new required env vars.

## Architecture

The codebase follows a strict layered flow for each resource: **routes → middleware → controller → service → repository → Sequelize model**. Each layer has one job, and new features (like posts) should be added by mirroring this same set of files per resource (e.g. `postRoutes.js`, `postController.js`, `postService.js`, `postRepository.js`, `database/models/postModel.js`, `schemas/postSchemas.js`).

- **`app.js`** wires up the Express app: JSON body parsing, `cors()`, and mounts feature routers under versioned-by-resource path prefixes (e.g. `/api/users`).
- **`server.js`** is the entry point: loads env vars, calls `sequelize.authenticate()` before starting the HTTP listener (so the process fails fast if the DB is unreachable), then imports and starts `app.js`.
- **`routes/`** wires an Express router, attaching `validate(schema)` and `authenticate` middleware in front of controller functions. Routes themselves contain no logic.
- **`middleware/userValidation.js`** exports a single higher-order `validate(schema)` middleware that runs a Zod schema's `safeParse` against `req.body`, replacing `req.body` with the parsed/coerced data on success or returning a 400 with the first Zod issue on failure. Reuse this pattern (`validate(schema)`) for any new resource rather than writing bespoke validation middleware.
- **`middleware/authMiddleware.js`** implements `authenticate`: requires a `Bearer` JWT, rejects revoked tokens (via `utils/tokenStore.js`), verifies it with `JWT_SECRET`, and attaches the decoded payload to `req.user` and the raw token to `req.token`.
- **`utils/tokenStore.js`** is an in-memory `Set` of revoked tokens used to implement logout. This state is per-process and not persisted — it resets on restart and won't work correctly across multiple server instances. Keep this limitation in mind if logout/session behavior is extended.
- **`schemas/`** holds Zod object schemas per resource, used both by `validate()` middleware and directly in services where needed.
- **`controllers/`** are thin: call into a service, map results/errors to HTTP status codes and JSON responses. They contain no business logic or direct DB access.
- **`services/`** hold business logic: uniqueness checks, password hashing (`bcryptjs`), JWT signing, and shaping the sanitized user object returned to clients (`sanitizeUser`, which strips the password hash). Services throw plain `Error`s with human-readable messages that controllers pattern-match on (e.g. `"Invalid email or password"` → 401).
- **`repositories/`** are the only layer that talks to Sequelize models directly (`findByPk`, `findOne`, `create`, etc.). Services never import a model directly — they go through a repository.
- **`database/dbconnection.js`** creates the shared `Sequelize` instance (MySQL dialect). **`database/models/`** defines Sequelize models and calls `Model.sync()` at import time — there are no migration files; schema changes happen via `sync()`.

Note: the existing user controller file is named `controllers/userContoller.js` (missing an "r") — match that exact filename when importing from it, don't "fix" the typo without updating the corresponding import in `routes/userRoutes.js`.

## Attribution note

`node_modules/` is currently committed to this repo's git history (not gitignored). `request.http` is listed in `.gitignore` but is also currently tracked in git — a pre-existing inconsistency, not something to silently "fix" as a side effect of unrelated changes.
