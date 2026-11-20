import { bodyKind } from '../throttle.ts';
import type { APIGatewayProxyWebsocketEventV2 } from 'aws-lambda';
import { PROTOCOL, type Principal } from '../../../protocol/frames.ts';
import { handle, presenceLeft } from '../router.ts';
import { store, newId, makeSender, putConnection, getConnection, dropConnection, queueSummary, queueGithub, queuePush, pushKey, files, site, users, agentClients, previewIce, makeSchedules, elevation } from '../aws.ts';

const schedules = makeSchedules();
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { CLASSIFIER_SYSTEM, classifierInput, parseVerdict, type MemoryVerdict } from '../../../protocol/memory.ts';

// Project memory, auto mode: one tool-less call per proposal (no tools, no history, 5 s at most: the frame waits).
// Unset model or any failure = unavailable: the router keeps the entry for a human.
const br = new BedrockRuntimeClient({});
const MEMORY_MODEL = process.env.MEMORY_MODEL;
const classifyMemory = MEMORY_MODEL ? async (text: string, sources: string[]): Promise<MemoryVerdict> => {
  const r = await br.send(new ConverseCommand({
    modelId: MEMORY_MODEL, system: [{ text: CLASSIFIER_SYSTEM }], messages: [{ role: 'user', content: [{ text: classifierInput(text, sources) }] }],
    inferenceConfig: { maxTokens: 5, temperature: 0 },
  }), { abortSignal: AbortSignal.timeout(5000) });
  return parseVerdict((r.output?.message?.content ?? []).map(c => c.text ?? '').join(''));
} : undefined;

type Ev = APIGatewayProxyWebsocketEventV2 & { requestContext: { authorizer?: { principalId?: string; kind?: string } } };

export const connect = async (event: Ev) => {
  const a = event.requestContext.authorizer;
  if (!a?.principalId || (a.kind !== 'human' && a.kind !== 'instance' && a.kind !== 'join' && a.kind !== 'visitor')) return { statusCode: 403 };
  await putConnection(event.requestContext.connectionId, { kind: a.kind, id: a.principalId } as Principal);
  // The browser requires the server to send back one of the offered subprotocols.
  return { statusCode: 200, headers: { 'Sec-WebSocket-Protocol': PROTOCOL } };
};

export const disconnect = async (event: Ev) => {
  const { connectionId, domainName, stage } = event.requestContext;
  const { who, left } = await dropConnection(connectionId);
  // Last seen recorded, then who is connected changed in those spaces (best effort: presenceLeft never throws).
  await presenceLeft({ store, sender: makeSender(domainName, stage) }, who, left, Date.now());
  return { statusCode: 200 };
};

export const message = async (event: Ev) => {
  const { connectionId, domainName, stage } = event.requestContext;
  // The principal comes from the connection recorded at $connect, never from the frame.
  const who = await getConnection(connectionId);
  if (!who) return { statusCode: 403 };
  const deps = { store, sender: makeSender(domainName, stage), now: () => Date.now(), newId, queueSummary, queueGithub, queuePush, pushKey, files, site, users, agentClients, classifyMemory, previewIce, schedules, elevation };
  try {
    await handle(deps, connectionId, who, event.body ?? '');
  } catch (e) {
    // No message body in the logs: only the error type.
    console.error('handle_failed', bodyKind(event.body ?? ''), (e as Error)?.name, (e as Error)?.message?.slice(0, 200));
    await deps.sender.send(connectionId, { v: 2, type: 'error', code: 'internal' });
  }
  return { statusCode: 200 };
};
