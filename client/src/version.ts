// New front version: scripts/build-client.ts compiles a build id into app.js and writes the same id to /version.json.
// The open app reads that file now and then; a different id means a deploy changed the front since this tab loaded.

/** Build id served in /version.json (`{ "build": "<id>" }`), null when the body is not one. */
export function servedBuild(body: unknown): string | null {
  const b = (body as { build?: unknown } | null)?.build;
  return typeof b === 'string' && /^[0-9a-f]{6,64}$/.test(b) ? b : null;
}

/** True when the served front differs from the running one. A missing or malformed file (local dev, a half deploy) is
 *  never « new »: a false alarm would ask for a reload that changes nothing. */
export function isNewBuild(running: string, body: unknown): boolean {
  const served = servedBuild(body);
  return served !== null && servedBuild({ build: running }) !== null && served !== running;
}
