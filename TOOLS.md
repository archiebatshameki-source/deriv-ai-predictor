# Tools

Notes about available tools and conventions for this agent.

## exec vs. long-lived dev servers

The `exec` tool is for **finite** shell commands (installs, builds, tests,
typechecks). It is wrapped in a 5-minute timeout and returns only when the
command exits.

**Do NOT** use `exec` to start long-running processes — Vite dev servers,
`expo start` / Metro, `bun run server.tsx`, watchers, REPLs, etc. They will
either:

1. block until the 5-minute timeout fires and then get killed, or
2. appear to "hang" the agent for the user.

Long-lived dev servers are owned by the runtime's PreviewManager. They start
automatically when the workspace is seeded and surface their URL via the
preview tool. If you need to restart them, use the dedicated preview/dev
controls — never `exec npx vite` or `exec npx expo start`.

Rule of thumb: if the command would not exit on its own within ~30s, it does
not belong in `exec`.
