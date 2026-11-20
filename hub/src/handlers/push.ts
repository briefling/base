// Web Push sender (SQS from the Message Lambda): the only Lambda that reads the VAPID private key (SSM SecureString).
// Who and what: sendPushes in ../push.ts. Encryption (RFC 8291) and VAPID (RFC 8292): the web-push library.
import type { SQSEvent } from 'aws-lambda';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import webpush from 'web-push';
import { store, KEY_CACHE_MS } from '../aws.ts';
import { sendPushes, type PushJob, type PushSend } from '../push.ts';
import { pushModule } from '../modules.ts';

/** Log label of a job: ids only (an endpoint is a capability URL, a title is content). */
const label = (job: any): string => 'memory' in job ? `memory:${job.memory}` : 'signal' in job ? `radar:${job.space}` : pushModule(job)?.push!.label(job) ?? job.thread;

const ssm = new SSMClient({});
// A pending push older than this is dropped by the push service (phone off for the night): Your turn shows in the app anyway.
const PUSH_TTL_S = 12 * 3600;

/** Key pair: public = plain String, private = SecureString (scripts/put-vapid-key.ts). Missing = nothing sent. Only a
 *  success is cached, for KEY_CACHE_MS like the public key the Message Lambda hands out (a rotation lands in both). */
let vapid: { publicKey: string; privateKey: string; at: number } | null = null;
async function keys() {
  if (vapid && Date.now() - vapid.at < KEY_CACHE_MS) return vapid;
  vapid = null;
  try {
    const [pub, priv] = await Promise.all([
      ssm.send(new GetParameterCommand({ Name: process.env.PUSH_PUBLIC_PARAM! })),
      ssm.send(new GetParameterCommand({ Name: process.env.PUSH_PRIVATE_PARAM!, WithDecryption: true })),
    ]);
    if (pub.Parameter?.Value && priv.Parameter?.Value) vapid = { publicKey: pub.Parameter.Value, privateKey: priv.Parameter.Value, at: Date.now() };
  } catch (e: any) { if (e?.name !== 'ParameterNotFound') throw e }
  return vapid;
}

export const handler = async (event: SQSEvent) => {
  const k = await keys();
  if (!k) { console.log('push_off'); return; }
  // RFC 8292 subject: the app's URL (no personal address; Apple requires a subject, refuses localhost).
  const vapidDetails = { subject: process.env.APP_URL!.replace(/\/$/, ''), publicKey: k.publicKey, privateKey: k.privateKey };
  const send: PushSend = async (sub, payload, topic) => {
    try {
      return (await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, payload, { vapidDetails, TTL: PUSH_TTL_S, urgency: 'high', topic, timeout: 5000 })).statusCode;
    } catch (e: any) { return typeof e?.statusCode === 'number' ? e.statusCode : 0 }
  };
  for (const rec of event.Records) {
    const job = JSON.parse(rec.body) as PushJob;
    try {
      // Counts only: an endpoint is a capability URL, a title is content. Neither goes to the logs.
      console.log('push', label(job), JSON.stringify(await sendPushes({ store, send }, job)));
    } catch (e) {
      // No retry: a retried job would push again to the devices already reached.
      console.error('push_failed', label(job), (e as Error)?.name, (e as Error)?.message?.slice(0, 200));
    }
  }
};
