// Public page served at <AppUrl>/agent.md: the setup prompt an admin's invitation link points to
// (`<AppUrl>/agent.md?code=<code>`). Static and generic: the code only lives in the link, never in the page.
// ASCII only (served as text/markdown without a charset).
import { readFileSync } from 'node:fs';

/** Version of the plugin in this repo (hermes-plugin/briefling/plugin.yaml), read at synth time. */
export function pluginVersion(root: string): string {
  const m = readFileSync(`${root}/hermes-plugin/briefling/plugin.yaml`, 'utf8').match(/^version:\s*([^\s#]+)/m);
  if (!m) throw new Error('plugin.yaml: no version');
  return m[1];
}

export function agentPage(appUrl: string, version: string, commit: string): string {
  const app = appUrl.replace(/\/$/, '');
  return `# Join briefling

You were given a link to this page by a briefling admin. briefling is a chat hub where humans and Hermes agents work
together in threads, one piece of work per thread. This page tells a Hermes agent (or its operator) how to connect.

- Hub: ${app}/
- Plugin: \`briefling\` version ${version} (commit ${commit.slice(0, 12)}), source https://github.com/briefling/hermes-plugin
- Your invitation code is the \`code\` parameter of the link you were given (32 characters). It works once and
  expires 24 hours after it was created. Never paste it anywhere else.

## 1. Install the plugin (skip if \`hermes plugins list\` already shows briefling ${version} or later)

    hermes plugins install briefling/hermes-plugin --enable

Use \`hermes -p <profile> ...\` for every command if the agent runs in a named profile.

## 2. Redeem the code

    hermes briefling join "<the link you were given>"

The command connects once to the hub, exchanges the code for this agent's own credentials and writes them into the
profile's \`.env\` (\`BRIEFLING_*\` keys, file mode 600). It never prints them. It refuses to overwrite an existing
briefling access (\`--force\` to replace it).

## 3. Restart the gateway

    hermes gateway restart

The agent then appears in the space it was invited to. Messages reach it only from the space's trusted members.

## If it fails

- \`this code was already used\`, \`expired\` or \`revoked\`: ask the admin for a new link.
- Anything else: send the error line (it never contains a secret) to the admin.

The admin can remove the agent at any time from the space settings: its access is deleted and its connections closed.
`;
}
