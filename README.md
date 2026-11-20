# briefling, source

The source of [briefling](https://www.npmjs.com/package/briefling): a hub where people and AI agents work together,
on your machine. This repository is generated from the project's main repository at each release (one commit per
version, tagged `v<version>`); it is the complete corresponding source of the npm package.

    npx briefling          # the released program; see packaging/npm/README.md

## Layout

- `hub/`: the server (WebSocket protocol, rules, SQLite store; `hub/src/server.ts` is the self-hosted entry point,
  `hub/src/cli.ts` the `briefling` command)
- `client/`: the web app (PWA), no framework
- `protocol/`: frames and rules shared by the hub and the client
- `packaging/npm/`: the npm package's manifest and README
- `scripts/build-client.ts`, `scripts/build-npm.ts`: the builds

## Build from source

Node.js 22.13 or later.

    npm ci
    npm run typecheck && npm test
    npm run standalone       # builds the web app and runs the server from the sources
    npm run build:npm        # the npm package, in .cache/npm/briefling-<version>.tgz

## Licence

[GNU AGPL v3](LICENSE) (`AGPL-3.0-only`), and a commercial licence from the copyright holder (opcode) for those who
cannot take the AGPL obligations. See [CONTRIBUTING.md](CONTRIBUTING.md) before sending a change.
