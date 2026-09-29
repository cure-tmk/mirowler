# @mirowler/cli

## Responsibility

A terminal command and a local stdio MCP server for the admin API. Both expose the same operations from `src/operations.ts` and talk to a running Worker only through `/api`, like the web app and curl. The Worker is unchanged by either.

It runs directly on Node 24 type stripping; there is no build step.

## Configuration

The credential is never passed on the command line. It comes from, in order:

1. `MIROWLER_URL` and `MIROWLER_AUTH` when both are set
2. The macOS login keychain, saved by `mirowler login <url>`; `MIROWLER_URL` alone picks the saved entry for that URL

| Variable | Value |
| --- | --- |
| `MIROWLER_URL` | The Worker's origin, e.g. `http://localhost:8787` for `pnpm dev` |
| `MIROWLER_AUTH` | The Worker's `ADMIN_BASIC_AUTH`, `user:password` |

```sh
node apps/cli/src/cli.ts login http://localhost:8787
node apps/cli/src/cli.ts logout
node apps/cli/src/cli.ts status
```

`login` has the `security` command prompt for `user:password` itself, so the value never appears in shell history or a process list. The keychain holds one Worker at a time: `login` replaces the previous entry and `logout` removes it. On other platforms, use the environment variables.

`status` prints which credential is in use (`env`, `keychain` or none), its URL and user, and whether the Worker accepts it; it exits 1 unless it does. The password is never printed.

## CLI

```sh
node apps/cli/src/cli.ts monitors list
node apps/cli/src/cli.ts preview --file preview.json
node apps/cli/src/cli.ts monitors create --file monitor.json
node apps/cli/src/cli.ts monitors run <monitor id>
node apps/cli/src/cli.ts runs list <monitor id> --limit 5
```

Run it without arguments for the full list: monitors (list, get, create, update, enable, disable, run, delete), runs list, notifications list, channels (list, create, update, delete, test) and preview.

- Request bodies (monitor and channel create/update, preview) come from `--file <path.json>`, in the shapes described in [apps/worker/README.md](../worker/README.md#admin-api). The CLI sends them as-is, so the Worker's 400 is what reports an invalid body.
- A 2xx response prints its JSON on stdout.
- A non-2xx response prints the whole response body on stderr and exits 1; a usage error exits 2.

## MCP server

`node apps/cli/src/cli.ts mcp` serves one tool per operation over stdio (`monitors_create`, `runs_list`, ...). Tools that change nothing are marked read-only and the delete tools destructive, so the client's permission prompt can tell them apart. Tool inputs are validated with core's monitor and preview schemas before any request; a non-2xx response becomes a tool error carrying the Worker's body, so the model can fix its input from `issues`.

After `mirowler login`, register it with Claude Code; nothing secret is written to its config:

```sh
claude mcp add --scope user mirowler -- node /absolute/path/to/mirowler/apps/cli/src/cli.ts mcp
```

After restarting Claude Code, `claude mcp list` shows `mirowler` as connected. The `node` Claude Code starts must be Node 24 or later; if an older one comes first on its `PATH`, give the absolute path of a Node 24 binary instead. The server acts on whichever Worker is logged in, so `status` tells which one the tools will change.

Without the keychain, use a `.mcp.json` that expands the values from the environment of the shell that starts Claude Code, rather than `claude mcp add -e MIROWLER_AUTH=...`, which would write the credential into `~/.claude.json`:

```json
{
  "mcpServers": {
    "mirowler": {
      "command": "node",
      "args": ["/absolute/path/to/mirowler/apps/cli/src/cli.ts", "mcp"],
      "env": { "MIROWLER_URL": "${MIROWLER_URL}", "MIROWLER_AUTH": "${MIROWLER_AUTH}" }
    }
  }
}
```

Don't commit a `.mcp.json` with real URLs or credentials.

The recommended flow for a new monitor is preview, create, run, then runs list; the procedure is in [Registering a stock monitor](../worker/README.md#registering-a-stock-monitor) and [Registering a price monitor](../worker/README.md#registering-a-price-monitor).

## API types

Like `apps/web`, this package imports the Worker's emitted route types as `@mirowler/worker/api` and calls the API through `hc`, so `pnpm typecheck` fails when a route it uses changes its path or params.

- Request bodies are not typed by it: no route declares a validator, so `hc` accepts any body. Body shapes come from core's schemas (for MCP input) and the Worker's 400.
- Responses are passed through as JSON without reading any field, so a response change breaks nothing here; `apps/web`'s typecheck is what catches response shape changes.
- Schemas are imported from `@mirowler/core/monitor`, never from the package root: type stripping cannot resolve the root index's extensionless relative imports.

## Not here

- Domain logic and D1 access; this is an API client only
- A remote MCP endpoint on the Worker: claude.ai connectors need OAuth and the Worker only has Basic auth
- Human-oriented output (tables, colors), config files, or profiles for several Workers
- Writing to stdout anywhere but the CLI entry point: in `mcp` mode stdout carries the protocol

## Checks

```sh
pnpm turbo run typecheck --filter=@mirowler/cli
pnpm -F @mirowler/cli test
```
