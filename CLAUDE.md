# Semantic commits

Use [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) for every commit:

`<type>[optional scope]: <description>`

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`.

Breaking changes use a `BREAKING CHANGE:` footer and/or `!` after the type. Keep the changelog in `CHANGELOG.md` (Keep a Changelog + SemVer).

Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Use `bunx <package> <command>` instead of `npx <package> <command>`
- Bun automatically loads .env, so don't use dotenv.

## APIs

- `Bun.serve()` supports WebSockets, HTTPS, and routes. Don't use `express`.
- `bun:sqlite` for SQLite. Don't use `better-sqlite3`.
- `Bun.redis` for Redis. Don't use `ioredis`.
- `Bun.sql` for Postgres. Don't use `pg` or `postgres.js`.
- `WebSocket` is built-in. Don't use `ws`.
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile
- Bun.$`ls` instead of execa.

## Testing

Use `bun test` to run tests.

```ts#index.test.ts
import { test, expect } from "bun:test";

test("hello world", () => {
  expect(1).toBe(1);
});
```

## Frontend

Use HTML imports with `Bun.serve()`. Don't use `vite`. HTML imports fully support React, CSS, Tailwind.

Server:

```ts#index.ts
import index from "./index.html"

Bun.serve({
  routes: {
    "/": index,
    "/api/users/:id": {
      GET: (req) => {
        return new Response(JSON.stringify({ id: req.params.id }));
      },
    },
  },
  // optional websocket support
  websocket: {
    open: (ws) => {
      ws.send("Hello, world!");
    },
    message: (ws, message) => {
      ws.send(message);
    },
    close: (ws) => {
      // handle close
    }
  },
  development: {
    hmr: true,
    console: true,
  }
})
```

HTML files can import .tsx, .jsx or .js files directly and Bun's bundler will transpile & bundle automatically. `<link>` tags can point to stylesheets and Bun's CSS bundler will bundle.

```html#index.html
<html>
  <body>
    <h1>Hello, world!</h1>
    <script type="module" src="./frontend.tsx"></script>
  </body>
</html>
```

With the following `frontend.tsx`:

```tsx#frontend.tsx
import React from "react";
import { createRoot } from "react-dom/client";

// import .css files directly and it works
import './index.css';

const root = createRoot(document.body);

export default function Frontend() {
  return <h1>Hello, world!</h1>;
}

root.render(<Frontend />);
```

Then, run index.ts

```sh
bun --hot ./index.ts
```

For more information, read the Bun API docs in `node_modules/bun-types/docs/**.mdx`.

# Architecture invariants

These are not style preferences. A change that violates one is wrong even if it
passes tests and ships a smaller diff.

## 1. Nothing in the extraction layer may write a judgment field.

Deterministic code describes what happened and enforces policy. It must never
turn a fact into a semantic conclusion.

```text
allowed:  automated = true            (a fact about delivery)
          credential_expired = true   (a fact about a code's TTL)
          list_unsubscribe = true     (a fact about a header)

forbidden: automated       → unimportant
           security        → verification code
           newsletter      → noise
           noreply@ sender → low priority
```

Every one of those shortcuts was in the classifier this rule replaced, and they
are how it produced `actionRequired: 0` on an inbox containing a failed
production payment. When something must be presented before a judgment exists,
report the extraction (`has_material_facts`), never a conclusion.

**Corollary:** anything deriving a judgment field must be *total*. Ordered
branch lists with a fallthrough default are how `severe + this_week → P3`
happens. Use exhaustive lookup tables over enumerable domains.

## 2. MailScribe core must never require a MailScribe-funded LLM call to produce or maintain inbox state.

All semantic judgment is executed by the external MCP client using the user's
own ChatGPT, Claude, or other AI entitlement. MailScribe provides intelligence
*infrastructure*; the connected AI provides intelligence *compute*.

MailScribe may: persist judgments, validate them, validate their evidence
against stored facts, apply deterministic policy clamps, derive priority bands,
maintain context, and serve it over MCP.

MailScribe may not: call a paid inference API as part of sync, ingestion,
classification, briefing, or any path required to produce inbox state.

Enforced by `tests/architecture_invariants.test.ts`. Do not add an inference
SDK to any workspace `package.json` — an internal "just a small fast model for
triage" tier is exactly the regression this prevents.
