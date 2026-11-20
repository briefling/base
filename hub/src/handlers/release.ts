// Release Lambda: invoked once by `npm run deploy` (scripts/deploy.ts) after the stack update, with the deployer's own
// credentials (no URL, no API, no schedule). The event is ignored: what it sends is this bundle's PLUGIN_RELEASE.
import { store, makeSenderFromEndpoint } from '../aws.ts';
import { announceRelease } from '../release.ts';

const sender = makeSenderFromEndpoint(process.env.WS_ENDPOINT!);

export async function handler() {
  const r = await announceRelease({ store, sender });
  console.log('release_announced', JSON.stringify(r));
  return r;
}
