// Store contract on the fake store of the router tests (hub/test/memstore.ts).
import { storeContract } from './store-contract.ts';
import { memStore } from './memstore.ts';

storeContract('memory', async () => {
  const m = memStore();
  return { store: m.store, seedAdmin: async (u: string) => { m.admins.add(u) } };
}, {
  // The fake keeps messages in write order: the router tests use ids that do not sort in time (`a1`, `id12`), while every
  // real id does (hub, Hermes plugin and ACP bridge: base36 ms + hex), so write order = id order in prod.
  'lastMessages: sorted by message id, whatever the write order': 'the fake keeps write order (router test ids are not time-sortable)',
  'lastMessages: before an unknown id = the messages with a smaller id': 'the fake finds `before` by position, not by id',
});
