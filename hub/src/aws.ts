// AWS adapters of the router: DynamoDB (Store) and API Gateway Management (Sender).
import { randomUUID } from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, ScanCommand, DeleteCommand, UpdateCommand, BatchGetCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, HeadObjectCommand, GetObjectCommand, DeleteObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { retryThrottled, frameKind } from './throttle.ts';
import { ApiGatewayManagementApiClient, PostToConnectionCommand, DeleteConnectionCommand, GoneException } from '@aws-sdk/client-apigatewaymanagementapi';
import { servedAs, publicThread, type Schedules, type Users, type Store, type Sender, type Sub, type Attachment, type Files, type Site, type StoredLock, type StoredResource, type Space, type Instance, type StoredAgentInvite, type AgentClients, type SearchThread, type SearchMessage, type StoredPreview, type StoredVisitor } from './router.ts';
import { PREVIEW_SESSION_S, type IceServer } from '../../protocol/preview.ts';
import { isCacheTtl, isUpdateBlock } from '../../protocol/plugin.ts';
import { pinFileOk } from '../../protocol/pinapp.ts';
import { KinesisVideoClient, GetSignalingChannelEndpointCommand } from '@aws-sdk/client-kinesis-video';
import { KinesisVideoSignalingClient, GetIceServerConfigCommand } from '@aws-sdk/client-kinesis-video-signaling';
import type { ThreadActivity } from './metrics.ts';
import type { StoredCiWatch } from './ci.ts';
import type { StoredBgWatch } from './background.ts';
import type { DetailsRows } from './details.ts';
import type { HiddenUsage, ThreadSummary, GhSnapshot, HubFrame, Message, Principal, PublicThread } from '../../protocol/frames.ts';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { SchedulerClient, CreateScheduleCommand, UpdateScheduleCommand, DeleteScheduleCommand, type CreateScheduleCommandInput } from '@aws-sdk/client-scheduler';
import { ROUTINE_TZ } from '../../protocol/routines.ts';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import type { PushJob } from './push.ts';
import { vocabIn, type MemoryConfig, type MemoryEntry } from '../../protocol/memory.ts';
import { EMPTY_TEAM, approvedColumn, workColumns } from '../../protocol/flowteam.ts';
import { CognitoIdentityProviderClient, AdminCreateUserCommand, AdminGetUserCommand, ListUsersCommand, CreateUserPoolClientCommand, DeleteUserPoolClientCommand, type AttributeType } from '@aws-sdk/client-cognito-identity-provider';

const TABLE = process.env.TABLE!;
export const THREADS_BY_ACTIVITY = 'byActivity'; // GSI name, also in infra/app.ts
const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });
const SEARCH_SEGMENTS = 4; // parallel Scan segments of a search
const SEARCH_QUERY_CONCURRENCY = 32; // thread Queries in flight in a one-space search (16: ~2x slower on 479 threads)
const SEARCH_QUERY_MAX_THREADS = 100; // above, a one-space search Scans instead (~3 ms a thread in the Lambda vs ~450 ms the Scan)
const TTL_S = 3 * 3600; // API Gateway drops connections at 2 h: keep 1 h of margin

const ttl = () => Math.floor(Date.now() / 1000) + TTL_S;
const PUSH_TTL_S = 60 * 86_400;
const flowSk = (version: number) => `FLOWCFG#${String(version).padStart(8, '0')}`;
const get = async (pk: string, sk: string) => (await doc.send(new GetCommand({ TableName: TABLE, Key: { pk, sk } }))).Item;
// Mail exchanges (EXCH#<space>): a mail sorts by date inside its exchange (13-digit ms, then its id).
const mailSk = (exchange: string, date: number, id: string) => `M#${exchange}#${String(date).padStart(13, '0')}#${id}`;
async function queryExch(space: string, prefix: string) {
  const out: Record<string, any>[] = [];
  let start: Record<string, any> | undefined;
  do {
    const r = await doc.send(new QueryCommand({ TableName: TABLE, KeyConditionExpression: 'pk = :p AND begins_with(sk, :s)',
      ExpressionAttributeValues: { ':p': `EXCH#${space}`, ':s': prefix }, ExclusiveStartKey: start }));
    out.push(...(r.Items ?? []));
    start = r.LastEvaluatedKey;
  } while (start);
  return out;
}
async function putVersioned(pk: string, sk: string, x: { version: number }, expected: number | null): Promise<boolean> {
  try {
    await doc.send(new PutCommand({ TableName: TABLE, Item: { pk, sk, data: JSON.stringify(x), version: x.version },
      ...(expected === null ? { ConditionExpression: 'attribute_not_exists(pk)' }
        : { ConditionExpression: '#v = :v', ExpressionAttributeNames: { '#v': 'version' }, ExpressionAttributeValues: { ':v': expected } }) }));
    return true;
  } catch (e: any) { if (e?.name === 'ConditionalCheckFailedException') return false; throw e; }
}
/** JSON `data` + `version` row, written under the version condition (null = creation); false when it moved. */
async function putJson(pk: string, sk: string, x: { version: number }, expected: number | null): Promise<boolean> {
  try {
    await doc.send(new PutCommand({ TableName: TABLE, Item: { pk, sk, data: JSON.stringify(x), version: x.version },
      ...(expected === null ? { ConditionExpression: 'attribute_not_exists(pk)' }
        : { ConditionExpression: '#v = :v', ExpressionAttributeNames: { '#v': 'version' }, ExpressionAttributeValues: { ':v': expected } }) }));
    return true;
  } catch (e: any) { if (e?.name === 'ConditionalCheckFailedException') return false; throw e; }
}

// Spaces and instances: an index (INDEX/SPACES, INDEX/INSTANCES, string sets) avoids any table scan.
const toSpace = (id: string, i: Record<string, any>): Space => ({ id, members: i.members ?? [], trusted: i.trusted ?? [], contributors: i.contributors ?? [], nontech: i.nontech ?? [], admins: i.admins ?? [], ...(i.modulesOff ? { modulesOff: [...i.modulesOff] } : {}), ...(i.modulesIn ? { modulesIn: [...i.modulesIn] } : {}), defaultAgent: i.defaultAgent, agents: i.agents,
  names: i.names, roles: i.roles, agentRoles: i.agentRoles, avatars: i.avatars, agentAvatars: i.agentAvatars, github: i.github, about: i.about, name: i.name, archived: i.archived, parallel: i.parallel, version: i.version,
  ...(i.driver ? { driver: i.driver } : {}), ...(i.identities ? { identities: [...i.identities] } : {}),
  ...(i.repos ? { repos: [...i.repos] } : {}), ...(i.repoOrgs ? { repoOrgs: [...i.repoOrgs] } : {}), ...(typeof i.ci === 'boolean' ? { ci: i.ci } : {}),
  ...(i.memory ? { memory: i.memory } : {}), ...(i.memoryAgent ? { memoryAgent: i.memoryAgent } : {}), ...(i.memoryHidden === true ? { memoryHidden: true } : {}),
  ...(i.memoryBatch ? { memoryBatch: { n: Number(i.memoryBatch.n), minutes: Number(i.memoryBatch.minutes) } } : {}),
  ...(i.memoryCompact ? { memoryCompact: { n: Number(i.memoryCompact.n), words: Number(i.memoryCompact.words) } } : {}),
  ...(i.tagMax !== undefined ? { tagMax: Number(i.tagMax) } : {}), ...(i.relayMax !== undefined ? { relayMax: Number(i.relayMax) } : {}),
  ...(i.memPending !== undefined ? { memPending: Number(i.memPending) } : {}), ...(i.memArrivals !== undefined ? { memArrivals: Number(i.memArrivals) } : {}) });
// `spaces` of an instance: a list (scripts); also read if it is a set.
const toInstance = (id: string, i: Record<string, any>): Instance => ({ id, spaces: [...(i.spaces ?? [])], agents: [...(i.agents ?? [])],
  ...(i.managed ? { managed: true } : {}), ...(i.connectedAt ? { connectedAt: Number(i.connectedAt) } : {}),
  ...(i.plugin?.version ? { plugin: { version: String(i.plugin.version), at: Number(i.plugin.at ?? 0), ...(typeof i.plugin.secretKey === 'string' ? { secretKey: i.plugin.secretKey } : {}),
    ...(i.plugin.kind === 'acp' ? { kind: 'acp' as const } : {}), // lost here, a bridge was judged against the plugin's release
    ...(i.plugin.voice === true ? { voice: true as const } : {}), ...(isUpdateBlock(i.plugin.update) ? { update: i.plugin.update } : {}),
    ...(isCacheTtl(i.plugin.cacheTtl) ? { cacheTtl: i.plugin.cacheTtl } : {}) } } : {}) });
// Agent invitations: one partition (a handful of items, kept 30 days after expiry by TTL), sort key = code hash.
const INVITES = 'AGENTINVITE';
const toInvite = (i: Record<string, any>): StoredAgentInvite => ({ hash: String(i.sk), id: i.id, space: i.space, agent: i.agent, by: i.by, at: Number(i.at),
  expiresAt: Number(i.expiresAt), state: i.state, ...(i.usedAt ? { usedAt: Number(i.usedAt) } : {}), ...(i.instance ? { instance: i.instance } : {}), ...(i.renew ? { renew: true as const } : {}) });
const indexed = async (sk: string, attr: string): Promise<string[]> => [...((await get('INDEX', sk))?.[attr] ?? [])];
async function batchGet(keys: { pk: string; sk: string }[]): Promise<Record<string, any>[]> {
  const out: Record<string, any>[] = [];
  for (let i = 0; i < keys.length; i += 100) {
    let req: any = { [TABLE]: { Keys: keys.slice(i, i + 100) } };
    for (let n = 0; n < 5 && req && Object.keys(req).length; n++) { // unprocessed keys (throughput): retry
      const r = await doc.send(new BatchGetCommand({ RequestItems: req }));
      out.push(...(r.Responses?.[TABLE] ?? []));
      req = r.UnprocessedKeys;
    }
  }
  return out;
}
const failed = (e: any) => e?.name === 'ConditionalCheckFailedException' || e?.name === 'TransactionCanceledException';
// Expected version: 0 = item written before the guard (no attribute) or never modified.
const versionIs = (expected: number) => expected === 0 ? 'attribute_not_exists(#v) OR #v = :e' : '#v = :e';

/** Id sortable in time, compatible with the router's ID_RE. */
export const newId = () => Date.now().toString(36) + randomUUID().replaceAll('-', '').slice(0, 12);

export const store: Store = {
  async getSpace(id) { const i = await get(`SPACE#${id}`, 'META'); return i ? toSpace(id, i) : null },
  async getInstance(id) { const i = await get(`INSTANCE#${id}`, 'META'); return i ? toInstance(id, i) : null },
  async listSpaces() {
    const ids = await indexed('SPACES', 'spaces');
    return (await batchGet(ids.map(s => ({ pk: `SPACE#${s}`, sk: 'META' })))).map(i => toSpace(String(i.pk).slice(6), i));
  },
  async isAdmin(user) { return (await indexed('ADMINS', 'users')).includes(user) },
  async createSpace(s) {
    const { id, ...item } = s;
    try {
      // Item and index together: never an invisible space (created but missing from the index).
      await doc.send(new TransactWriteCommand({ TransactItems: [
        { Put: { TableName: TABLE, Item: { pk: `SPACE#${id}`, sk: 'META', ...item }, ConditionExpression: 'attribute_not_exists(pk)' } },
        { Update: { TableName: TABLE, Key: { pk: 'INDEX', sk: 'SPACES' }, UpdateExpression: 'ADD #s :s', ExpressionAttributeNames: { '#s': 'spaces' }, ExpressionAttributeValues: { ':s': new Set([id]) } } },
      ] }));
      return true;
    } catch (e: any) { if (failed(e)) return false; throw e; }
  },
  async updateSpace(s, expected) {
    try {
      await doc.send(new UpdateCommand({ TableName: TABLE, Key: { pk: `SPACE#${s.id}`, sk: 'META' },
        // Every name aliased (DynamoDB reserved words: `name`…; see the skill, `spaces` pitfall).
        UpdateExpression: 'SET #n = :n, #ab = :about, #m = :m, #t = :t, #co = :co, #ag = :a, #d = :d, #names = :names, #roles = :roles, #ar2 = :ar2, #av = :av, #aav = :aav, #nt = :nt, #adm = :adm, #v = :v'
          + (s.parallel ? ', #par = :par' : '') + (s.driver ? ', #drv = :drv' : '') + (s.identities ? ', #ids = :ids' : '')
          + (s.repos ? ', #repos = :repos' : '') + (s.repoOrgs ? ', #rorg = :rorg' : '') + (typeof s.ci === 'boolean' ? ', #ci = :ci' : '') + (s.memory ? ', #mem = :mem' : '') + (s.memoryAgent ? ', #mag = :mag' : '') + (typeof s.memoryHidden === 'boolean' ? ', #mh = :mh' : '')
          + (s.memoryBatch ? ', #mb = :mb' : '') + (s.memoryCompact ? ', #mc = :mc' : '') + (s.tagMax !== undefined ? ', #tm = :tm' : '') + (s.relayMax !== undefined ? ', #rx = :rx' : '') + (s.modulesOff ? ', #mo = :mo' : '') + (s.modulesIn ? ', #mi = :mi' : '')
          + (s.archived ? ', #ar = :ar' : ' REMOVE #ar'),
        ConditionExpression: `attribute_exists(pk) AND (${versionIs(expected)})`,
        ExpressionAttributeNames: { '#n': 'name', '#ab': 'about', '#m': 'members', '#t': 'trusted', '#co': 'contributors', '#ag': 'agents', '#d': 'defaultAgent', '#names': 'names', '#roles': 'roles', '#ar2': 'agentRoles', '#av': 'avatars', '#aav': 'agentAvatars', '#nt': 'nontech', '#adm': 'admins', '#v': 'version', '#ar': 'archived', ...(s.parallel ? { '#par': 'parallel' } : {}),
          ...(s.driver ? { '#drv': 'driver' } : {}), ...(s.identities ? { '#ids': 'identities' } : {}),
          ...(s.repos ? { '#repos': 'repos' } : {}), ...(s.repoOrgs ? { '#rorg': 'repoOrgs' } : {}), ...(typeof s.ci === 'boolean' ? { '#ci': 'ci' } : {}), ...(s.memory ? { '#mem': 'memory' } : {}), ...(s.memoryAgent ? { '#mag': 'memoryAgent' } : {}), ...(typeof s.memoryHidden === 'boolean' ? { '#mh': 'memoryHidden' } : {}),
          ...(s.memoryBatch ? { '#mb': 'memoryBatch' } : {}), ...(s.memoryCompact ? { '#mc': 'memoryCompact' } : {}), ...(s.tagMax !== undefined ? { '#tm': 'tagMax' } : {}), ...(s.relayMax !== undefined ? { '#rx': 'relayMax' } : {}), ...(s.modulesOff ? { '#mo': 'modulesOff' } : {}), ...(s.modulesIn ? { '#mi': 'modulesIn' } : {}) },
        ExpressionAttributeValues: { ':n': s.name ?? s.id, ':about': s.about ?? '', ':m': s.members, ':t': s.trusted, ':co': s.contributors ?? [], ':a': s.agents ?? [s.defaultAgent], ':d': s.defaultAgent,
          ':names': s.names ?? {}, ':roles': s.roles ?? {}, ':ar2': s.agentRoles ?? {}, ':av': s.avatars ?? {}, ':aav': s.agentAvatars ?? {}, ':nt': s.nontech ?? [], ':adm': s.admins ?? [], ':v': s.version, ':e': expected, ...(s.archived ? { ':ar': s.archived } : {}), ...(s.parallel ? { ':par': s.parallel } : {}),
          ...(s.driver ? { ':drv': s.driver } : {}), ...(s.identities ? { ':ids': s.identities } : {}),
          ...(s.repos ? { ':repos': s.repos } : {}), ...(s.repoOrgs ? { ':rorg': s.repoOrgs } : {}), ...(typeof s.ci === 'boolean' ? { ':ci': s.ci } : {}), ...(s.memory ? { ':mem': s.memory } : {}), ...(s.memoryAgent ? { ':mag': s.memoryAgent } : {}), ...(typeof s.memoryHidden === 'boolean' ? { ':mh': s.memoryHidden } : {}),
          ...(s.memoryBatch ? { ':mb': s.memoryBatch } : {}), ...(s.memoryCompact ? { ':mc': s.memoryCompact } : {}), ...(s.tagMax !== undefined ? { ':tm': s.tagMax } : {}), ...(s.relayMax !== undefined ? { ':rx': s.relayMax } : {}), ...(s.modulesOff ? { ':mo': s.modulesOff } : {}), ...(s.modulesIn ? { ':mi': s.modulesIn } : {}) } }));
      return true;
    } catch (e: any) { if (failed(e)) return false; throw e; }
  },
  async setProfile(space, user, name, role, avatar) {
    const Key = { pk: `SPACE#${space}`, sk: 'META' };
    try {
      // names / roles / avatars may be missing on a space written before them: created first, then only this member's entries.
      await doc.send(new UpdateCommand({ TableName: TABLE, Key, UpdateExpression: 'SET #names = if_not_exists(#names, :e), #roles = if_not_exists(#roles, :e), #av = if_not_exists(#av, :e)',
        ConditionExpression: 'contains(#m, :u)', ExpressionAttributeNames: { '#names': 'names', '#roles': 'roles', '#av': 'avatars', '#m': 'members' }, ExpressionAttributeValues: { ':e': {}, ':u': user } }));
      const set = ['#names.#u = :n', ...(role ? ['#roles.#u = :r'] : []), ...(avatar ? ['#av.#u = :a'] : [])];
      const remove = [...(role ? [] : ['#roles.#u']), ...(avatar === '' ? ['#av.#u'] : [])];
      await doc.send(new UpdateCommand({ TableName: TABLE, Key, UpdateExpression: `SET ${set.join(', ')}` + (remove.length ? ` REMOVE ${remove.join(', ')}` : ''),
        ConditionExpression: 'contains(#m, :u)', ExpressionAttributeNames: { '#names': 'names', '#roles': 'roles', '#m': 'members', '#u': user, ...(avatar !== undefined ? { '#av': 'avatars' } : {}) },
        ExpressionAttributeValues: { ':n': name, ':u': user, ...(role ? { ':r': role } : {}), ...(avatar ? { ':a': avatar } : {}) } }));
      return true;
    } catch (e: any) { if (failed(e)) return false; throw e; }
  },
  async listInstances() {
    const ids = await indexed('INSTANCES', 'ids');
    return (await batchGet(ids.map(i => ({ pk: `INSTANCE#${i}`, sk: 'META' })))).map(i => toInstance(String(i.pk).slice(9), i));
  },
  async createInstance(inst) {
    const { id, ...item } = inst;
    try {
      // Item and index together, like spaces: never an instance missing from listInstances.
      await doc.send(new TransactWriteCommand({ TransactItems: [
        { Put: { TableName: TABLE, Item: { pk: `INSTANCE#${id}`, sk: 'META', ...item }, ConditionExpression: 'attribute_not_exists(pk)' } },
        { Update: { TableName: TABLE, Key: { pk: 'INDEX', sk: 'INSTANCES' }, UpdateExpression: 'ADD ids :i', ExpressionAttributeValues: { ':i': new Set([id]) } } },
      ] }));
      return true;
    } catch (e: any) { if (failed(e)) return false; throw e; }
  },
  async deleteInstance(id) {
    await doc.send(new TransactWriteCommand({ TransactItems: [
      { Delete: { TableName: TABLE, Key: { pk: `INSTANCE#${id}`, sk: 'META' } } },
      { Update: { TableName: TABLE, Key: { pk: 'INDEX', sk: 'INSTANCES' }, UpdateExpression: 'DELETE ids :i', ExpressionAttributeValues: { ':i': new Set([id]) } } },
    ] }));
  },
  async markInstanceConnected(id, at) {
    try {
      await doc.send(new UpdateCommand({ TableName: TABLE, Key: { pk: `INSTANCE#${id}`, sk: 'META' }, UpdateExpression: 'SET connectedAt = :a',
        ConditionExpression: 'attribute_exists(pk) AND attribute_not_exists(connectedAt)', ExpressionAttributeValues: { ':a': at } }));
    } catch (e: any) { if (!failed(e)) throw e; }
  },
  async putAgentInvite(inv) {
    const { hash, ...item } = inv;
    await doc.send(new PutCommand({ TableName: TABLE, Item: { pk: INVITES, sk: hash, ...item, ttl: Math.floor(inv.expiresAt / 1000) + 30 * 86400 },
      ConditionExpression: 'attribute_not_exists(pk)' }));
  },
  async getAgentInvite(hash) { const i = await get(INVITES, hash); return i ? toInvite(i) : null },
  async listAgentInvites() {
    const out: StoredAgentInvite[] = [];
    let start: Record<string, any> | undefined;
    do {
      const r = await doc.send(new QueryCommand({ TableName: TABLE, KeyConditionExpression: 'pk = :p', ExpressionAttributeValues: { ':p': INVITES }, ExclusiveStartKey: start }));
      out.push(...(r.Items ?? []).map(toInvite));
      start = r.LastEvaluatedKey;
    } while (start);
    return out;
  },
  async claimAgentInvite(hash, now) {
    try {
      await doc.send(new UpdateCommand({ TableName: TABLE, Key: { pk: INVITES, sk: hash }, UpdateExpression: 'SET #st = :u, usedAt = :n',
        ConditionExpression: '#st = :p AND expiresAt > :n', ExpressionAttributeNames: { '#st': 'state' }, ExpressionAttributeValues: { ':u': 'used', ':p': 'pending', ':n': now } }));
      return true;
    } catch (e: any) { if (failed(e)) return false; throw e; }
  },
  async setAgentInvite(hash, from, patch) {
    const names: Record<string, string> = { '#st': 'state' }, values: Record<string, any> = { ':from': from };
    const sets: string[] = [];
    if (patch.state) { sets.push('#st = :to'); values[':to'] = patch.state; }
    if (patch.instance) { sets.push('instance = :i'); values[':i'] = patch.instance; }
    // back to pending (undone join): the code is usable again, no trace of the failed use
    const remove = patch.state === 'pending' ? ' REMOVE usedAt, instance' : '';
    try {
      await doc.send(new UpdateCommand({ TableName: TABLE, Key: { pk: INVITES, sk: hash }, UpdateExpression: `SET ${sets.join(', ')}${remove}`,
        ConditionExpression: 'attribute_exists(pk) AND #st = :from', ExpressionAttributeNames: names, ExpressionAttributeValues: values }));
      return true;
    } catch (e: any) { if (failed(e)) return false; throw e; }
  },
  async setInstancePlugin(id, plugin) {
    // Own attribute, `version` untouched (bindInstance's guard); a later `at` wins (two connections of one instance).
    try {
      await doc.send(new UpdateCommand({ TableName: TABLE, Key: { pk: `INSTANCE#${id}`, sk: 'META' }, UpdateExpression: 'SET #p = :p',
        ConditionExpression: 'attribute_exists(pk) AND (attribute_not_exists(#p) OR #p.#at < :at)',
        ExpressionAttributeNames: { '#p': 'plugin', '#at': 'at' }, ExpressionAttributeValues: { ':p': plugin, ':at': plugin.at } }));
    } catch (e: any) { if (!failed(e)) throw e; }
  },
  async bindInstance(id, space, on) {
    // Read-modify-write under a `version` guard (two space settings saved at the same time touch the same instance).
    for (let attempt = 0; attempt < 3; attempt++) {
      const i = await get(`INSTANCE#${id}`, 'META');
      if (!i) return;
      const cur: string[] = [...(i.spaces ?? [])];
      if (cur.includes(space) === on) return;
      const next = on ? [...cur, space] : cur.filter(s => s !== space);
      const v = Number(i.version ?? 0);
      try {
        await doc.send(new UpdateCommand({ TableName: TABLE, Key: { pk: `INSTANCE#${id}`, sk: 'META' }, UpdateExpression: 'SET #s = :s, #v = :v1',
          ConditionExpression: versionIs(v), ExpressionAttributeNames: { '#s': 'spaces', '#v': 'version' }, ExpressionAttributeValues: { ':s': next, ':v1': v + 1, ':e': v } }));
        return;
      } catch (e: any) { if (!failed(e)) throw e; }
    }
    throw new Error('instance_conflict');
  },
  async putSub(space, sub) {
    await doc.send(new PutCommand({ TableName: TABLE, Item: { pk: `SUB#${space}`, sk: `CONN#${sub.connId}`, kind: sub.kind, principal: sub.principal, ttl: ttl() } }));
    await doc.send(new UpdateCommand({ TableName: TABLE, Key: { pk: `CONN#${sub.connId}`, sk: 'META' }, UpdateExpression: 'ADD #s :s', ExpressionAttributeNames: { '#s': 'spaces' }, ExpressionAttributeValues: { ':s': new Set([space]) } }));
  },
  async listSubs(space) {
    const r = await doc.send(new QueryCommand({ TableName: TABLE, KeyConditionExpression: 'pk = :p', ExpressionAttributeValues: { ':p': `SUB#${space}` } }));
    const now = Math.floor(Date.now() / 1000);
    return (r.Items ?? []).filter(i => i.ttl > now).map(i => ({ connId: String(i.sk).slice(5), kind: i.kind, principal: i.principal,
      ...(i.away === true ? { away: true, ...(typeof i.idle === 'number' ? { idle: i.idle } : {}) } : {}), ...(typeof i.watch === 'string' ? { watch: i.watch } : {}) }) as Sub);
  },
  async deleteSub(space, connId) { await doc.send(new DeleteCommand({ TableName: TABLE, Key: { pk: `SUB#${space}`, sk: `CONN#${connId}` } })) },
  async setSubWatch(space, connId, thread) {
    try {
      await doc.send(new UpdateCommand({ TableName: TABLE, Key: { pk: `SUB#${space}`, sk: `CONN#${connId}` },
        UpdateExpression: thread ? 'SET #w = :w' : 'REMOVE #w', ConditionExpression: 'attribute_exists(pk)', ExpressionAttributeNames: { '#w': 'watch' },
        ...(thread ? { ExpressionAttributeValues: { ':w': thread } } : {}) }));
      return true;
    } catch (e: any) { if (failed(e)) return false; throw e; }
  },
  async setSubAway(space, connId, away, idle) {
    try {
      await doc.send(new UpdateCommand({ TableName: TABLE, Key: { pk: `SUB#${space}`, sk: `CONN#${connId}` },
        UpdateExpression: away && idle !== undefined ? 'SET #a = :a, #i = :i' : 'SET #a = :a REMOVE #i',
        ConditionExpression: 'attribute_exists(pk)', ExpressionAttributeNames: { '#a': 'away', '#i': 'idle' },
        ExpressionAttributeValues: { ':a': away, ...(away && idle !== undefined ? { ':i': idle } : {}) } }));
      return true;
    } catch (e: any) { if (failed(e)) return false; throw e; }
  },
  // SPACE#<s>/SEEN#<id>: one item per principal and space, moved forward only (two tabs closing out of order).
  async markSeen(space, ids, at) {
    for (const id of ids) {
      try {
        await doc.send(new UpdateCommand({ TableName: TABLE, Key: { pk: `SPACE#${space}`, sk: `SEEN#${id}` }, UpdateExpression: 'SET #t = :t',
          ConditionExpression: 'attribute_not_exists(#t) OR #t < :t', ExpressionAttributeNames: { '#t': 'at' }, ExpressionAttributeValues: { ':t': at } }));
      } catch (e: any) { if (!failed(e)) throw e; }
    }
  },
  async lastSeen(space) {
    const r = await doc.send(new QueryCommand({ TableName: TABLE, KeyConditionExpression: 'pk = :p AND begins_with(sk, :s)', ExpressionAttributeValues: { ':p': `SPACE#${space}`, ':s': 'SEEN#' } }));
    return Object.fromEntries((r.Items ?? []).filter(i => typeof i.at === 'number').map(i => [String(i.sk).slice(5), i.at as number]));
  },
  async connSpaces(connId) { return [...((await get(`CONN#${connId}`, 'META'))?.spaces as Set<string> | undefined) ?? []] },
  // INSTANCE#<id>/CONN#<conn>: same TTL as the connection, deleted at $disconnect (dropConnection).
  async putInstanceConn(instance, connId) { await doc.send(new PutCommand({ TableName: TABLE, Item: { pk: `INSTANCE#${instance}`, sk: `CONN#${connId}`, ttl: ttl() } })) },
  async listInstanceConns(instance) {
    const r = await doc.send(new QueryCommand({ TableName: TABLE, KeyConditionExpression: 'pk = :p AND begins_with(sk, :c)', ExpressionAttributeValues: { ':p': `INSTANCE#${instance}`, ':c': 'CONN#' } }));
    const now = Math.floor(Date.now() / 1000);
    return (r.Items ?? []).filter(i => i.ttl > now).map(i => String(i.sk).slice(5));
  },
  async getThread(id) { const i = await get(`THREAD#${id}`, 'META'); if (!i) return null; const { pk, sk, ...t } = i; return t as any },
  async putThread(thread, expected) {
    try {
      await doc.send(new PutCommand({
        TableName: TABLE, Item: { pk: `THREAD#${thread.id}`, sk: 'META', ...thread },
        ...(expected === null ? { ConditionExpression: 'attribute_not_exists(pk)' }
          : { ConditionExpression: '#v = :v', ExpressionAttributeNames: { '#v': 'version' }, ExpressionAttributeValues: { ':v': expected } }),
      }));
    } catch (e: any) { if (e?.name === 'ConditionalCheckFailedException') return false; throw e; }
    // Index SPACE#<space> / THREAD#<id> for `sync` (public view, `unseen` included): never overwrites a more recent version.
    // The memory agent's review conversation has none: never listed, searched nor counted in metrics.
    if (thread.memoryReview) return true;
    const pub = publicThread(thread);
    try {
      await doc.send(new PutCommand({
        TableName: TABLE, Item: { pk: `SPACE#${thread.space}`, sk: `THREAD#${thread.id}`, ...pub },
        ConditionExpression: 'attribute_not_exists(#v) OR #v < :v', ExpressionAttributeNames: { '#v': 'version' }, ExpressionAttributeValues: { ':v': thread.version },
      }));
    } catch (e: any) { if (e?.name !== 'ConditionalCheckFailedException') throw e; }
    return true;
  },
  // Thread list by activity: GSI `byActivity` (pk, updatedAt). Only items with `updatedAt` are in it: the SPACE#/THREAD#
  // index items and the THREAD#/META items (other partitions, never read here). The filter keeps the THREAD# rows anyway.
  async pageThreads(space, limit, after) {
    const r = await doc.send(new QueryCommand({ TableName: TABLE, IndexName: THREADS_BY_ACTIVITY, KeyConditionExpression: 'pk = :p', FilterExpression: 'begins_with(sk, :t)',
      ExpressionAttributeValues: { ':p': `SPACE#${space}`, ':t': 'THREAD#' }, ScanIndexForward: false, Limit: limit,
      // The partition comes from the hub (member's space), never from the cursor.
      ...(after ? { ExclusiveStartKey: { pk: `SPACE#${space}`, sk: `THREAD#${after.id}`, updatedAt: after.updatedAt } } : {}) }));
    const k = r.LastEvaluatedKey;
    return { threads: (r.Items ?? []).map(({ pk, sk, ...t }) => t as PublicThread), next: k ? { updatedAt: Number(k.updatedAt), id: String(k.sk).slice(7) } : null };
  },
  async activeThreads(space) {
    // Whole partition read, every page (LastEvaluatedKey): only the matches come back, but a single page would miss some silently.
    const out: PublicThread[] = [];
    let start: Record<string, any> | undefined;
    do {
      const r = await doc.send(new QueryCommand({ TableName: TABLE, KeyConditionExpression: 'pk = :p AND begins_with(sk, :t)', ExclusiveStartKey: start,
        FilterExpression: '#st IN (:you, :run) AND attribute_not_exists(archived)', ExpressionAttributeNames: { '#st': 'state' },
        ExpressionAttributeValues: { ':p': `SPACE#${space}`, ':t': 'THREAD#', ':you': 'you', ':run': 'run' } }));
      out.push(...(r.Items ?? []).map(({ pk, sk, ...t }) => t as PublicThread));
      start = r.LastEvaluatedKey;
    } while (start);
    return out;
  },
  async threadsByIds(space, ids) {
    return (await batchGet([...new Set(ids)].map(id => ({ pk: `SPACE#${space}`, sk: `THREAD#${id}` })))).map(({ pk, sk, ...t }) => t as PublicThread);
  },
  async listThreads(space, since) {
    // Whole partition, every page; only what the metrics read (title for the most expensive, no text) and the compaction
    // (heading, tags: conversations left untagged), `since` filtered server-side.
    const out: PublicThread[] = [];
    let start: Record<string, any> | undefined;
    do {
      const r = await doc.send(new QueryCommand({ TableName: TABLE, KeyConditionExpression: 'pk = :p AND begins_with(sk, :t)', ExclusiveStartKey: start,
        FilterExpression: 'updatedAt >= :s', ProjectionExpression: 'id, #sp, #k, #f, title, author, #o, #st, archived, outcome, #u, updatedAt, version, #tg, #hd',
        ExpressionAttributeNames: { '#sp': 'space', '#k': 'kind', '#f': 'from', '#o': 'owner', '#st': 'state', '#u': 'usage', '#tg': 'tags', '#hd': 'heading' },
        ExpressionAttributeValues: { ':p': `SPACE#${space}`, ':t': 'THREAD#', ':s': since } }));
      out.push(...(r.Items ?? []) as PublicThread[]);
      start = r.LastEvaluatedKey;
    } while (start);
    return out;
  },
  async threadActivity(thread) {
    // One partition: META (opener) + MSG# (author, date, opened card); REACT# rows are skipped.
    const out: ThreadActivity = { messages: [] };
    let start: Record<string, any> | undefined;
    do {
      const r = await doc.send(new QueryCommand({ TableName: TABLE, KeyConditionExpression: 'pk = :p', ExclusiveStartKey: start,
        ProjectionExpression: 'sk, id, opener, author, #at, #pr.#th, #pr.#ti, #pr.#ps, #pr.#by', ExpressionAttributeNames: { '#at': 'at', '#pr': 'propose', '#th': 'thread', '#ti': 'title', '#ps': 'status', '#by': 'by' },
        ExpressionAttributeValues: { ':p': `THREAD#${thread}` } }));
      for (const i of r.Items ?? []) {
        if (i.sk === 'META') { if (typeof i.opener === 'string') out.opener = i.opener; }
        else if (String(i.sk).startsWith('MSG#') && i.author) out.messages.push({ id: i.id, kind: i.author.kind, author: i.author.id, at: i.at, ...(i.propose?.thread ? { card: i.propose.thread } : {}),
          ...(i.propose?.status === 'open' && !i.propose.thread && typeof i.propose.title === 'string' ? { proposed: { title: i.propose.title, ...(i.propose.by ? { by: i.propose.by } : {}) } } : {}) });
      }
      start = r.LastEvaluatedKey;
    } while (start);
    return out;
  },
  async upsertMessage(m: Message) {
    // sk = MSG#<id>: ids are sortable in time, a rewrite (streaming) keeps its place and its timestamp.
    const rev = m.rev ?? 0;
    let r;
    try {
      r = await doc.send(new UpdateCommand({
        TableName: TABLE, Key: { pk: `THREAD#${m.thread}`, sk: `MSG#${m.id}` },
        // files: written only when provided (a re-edit without attachments does not erase them)
        UpdateExpression: 'SET #t = :t, #id = :id, #th = :th, author = :a, #ty = :ty, ask = :ask, propose = :pr, #at = if_not_exists(#at, :at), #rev = :rev' + (m.files?.length ? ', files = :files' : '') + (m.about ? ', #ab = :ab' : '') + (m.gh ? ', gh = :gh' : '') + (m.newIssue ? ', newIssue = :ni' : '') + (m.plan ? ', #pl = :pl' : '') + (m.elevation ? ', #el = :el' : '') + (m.stop ? ', #sp = :sp' : '') + (m.secret ? ', #sc = :sc' : '') + (m.preview ? ', #pv = :pv' : '') + (m.ci ? ', ci = :ci' : '') + (m.edited ? ', edited = :ed' : '') + (m.notice ? ', notice = :nt' : '') + (m.plugin ? ', #pg = :pg' : '') + (m.origin ? ', #og = :og' : '') + (m.applet ? ', #ap = :ap' : '') + (m.reminder ? ', #rm = :rm' : '') + (m.voiceAsk ? ', voiceAsk = :va' : '') + (m.relayCap !== undefined ? ', relayCap = :rc' : ''),
        // An older edit (lower rev) must never overwrite the latest one.
        ConditionExpression: 'attribute_not_exists(#rev) OR #rev < :rev OR :rev = :zero',
        ExpressionAttributeNames: { '#t': 'text', '#id': 'id', '#th': 'thread', '#ty': 'type', '#at': 'at', '#rev': 'rev', ...(m.about ? { '#ab': 'about' } : {}), ...(m.stop ? { '#sp': 'stop' } : {}), ...(m.secret ? { '#sc': 'secret' } : {}), ...(m.preview ? { '#pv': 'preview' } : {}), ...(m.plugin ? { '#pg': 'plugin' } : {}), ...(m.plan ? { '#pl': 'plan' } : {}), ...(m.elevation ? { '#el': 'elevation' } : {}), ...(m.origin ? { '#og': 'origin' } : {}), ...(m.applet ? { '#ap': 'applet' } : {}), ...(m.reminder ? { '#rm': 'reminder' } : {}) },
        ExpressionAttributeValues: { ':t': m.text, ':id': m.id, ':th': m.thread, ':a': m.author, ':ty': m.type, ':ask': m.ask ?? null, ':pr': m.propose ?? null, ':at': m.at, ...(m.files?.length ? { ':files': m.files } : {}), ...(m.about ? { ':ab': m.about } : {}), ...(m.gh ? { ':gh': m.gh } : {}), ...(m.newIssue ? { ':ni': m.newIssue } : {}), ...(m.plan ? { ':pl': m.plan } : {}), ...(m.elevation ? { ':el': m.elevation } : {}), ...(m.stop ? { ':sp': m.stop } : {}), ...(m.secret ? { ':sc': m.secret } : {}), ...(m.preview ? { ':pv': m.preview } : {}), ...(m.ci ? { ':ci': m.ci } : {}), ...(m.edited ? { ':ed': m.edited } : {}), ...(m.notice ? { ':nt': true } : {}), ...(m.plugin ? { ':pg': m.plugin } : {}), ...(m.origin ? { ':og': m.origin } : {}), ...(m.applet ? { ':ap': m.applet } : {}), ...(m.reminder ? { ':rm': m.reminder } : {}), ...(m.voiceAsk ? { ':va': true } : {}), ...(m.relayCap !== undefined ? { ':rc': m.relayCap } : {}), ':rev': rev, ':zero': 0 },
        ReturnValues: 'ALL_NEW',
      }));
    } catch (e: any) { if (e?.name === 'ConditionalCheckFailedException') return null; throw e; }
    const { pk, sk, ...stored } = r.Attributes as any;
    if (stored.ask === null) delete stored.ask;
    return { created: stored.at === m.at, message: stored as Message };
  },
  // CI follow-up: one item per thread and repo, TTL one day after the deadline (a watch the poller never ended goes).
  async putCiWatch(w) {
    await doc.send(new PutCommand({ TableName: TABLE, Item: { pk: 'CIWATCH', sk: `${w.thread}#${w.repo}`, ...w, ttl: Math.floor(w.deadline / 1000) + 86_400 } }));
  },
  async listCiWatches() {
    const out: StoredCiWatch[] = [];
    let start: Record<string, any> | undefined;
    do {
      const r = await doc.send(new QueryCommand({ TableName: TABLE, KeyConditionExpression: 'pk = :p', ExpressionAttributeValues: { ':p': 'CIWATCH' }, ExclusiveStartKey: start }));
      for (const { pk, sk, ttl: _, ...w } of r.Items ?? []) out.push(w as StoredCiWatch);
      start = r.LastEvaluatedKey;
    } while (start);
    return out;
  },
  async putEvent(thread, id, ev) {
    // sk sorts by hub time; the event itself as JSON (`data`): no attribute list to keep in sync with ThreadEvent.
    await doc.send(new PutCommand({ TableName: TABLE, Item: { pk: `THREAD#${thread}`, sk: `EV#${String(ev.at).padStart(15, '0')}#${id}`, data: JSON.stringify(ev) } }));
  },
  async threadDetails(thread) {
    // One partition: MSG# (date, author, files) and EV# (timeline); META, SUMMARY and REACT# rows are skipped.
    const out: DetailsRows = { first: null, files: [], events: [] };
    let start: Record<string, any> | undefined;
    do {
      const r = await doc.send(new QueryCommand({ TableName: TABLE, KeyConditionExpression: 'pk = :p', ExclusiveStartKey: start,
        ProjectionExpression: 'sk, id, author, #at, files, #d', ExpressionAttributeNames: { '#at': 'at', '#d': 'data' }, ExpressionAttributeValues: { ':p': `THREAD#${thread}` } }));
      for (const i of r.Items ?? []) {
        const sk = String(i.sk);
        if (sk.startsWith('MSG#') && typeof i.at === 'number') {
          if (out.first === null || i.at < out.first) out.first = i.at;
          for (const f of Array.isArray(i.files) ? i.files : []) out.files.push({ ...f, msg: i.id, by: i.author?.id ?? '', at: i.at });
        } else if (sk.startsWith('EV#') && typeof i.data === 'string') {
          try { out.events.push(JSON.parse(i.data)); } catch { /* unreadable row: skipped */ }
        }
      }
      start = r.LastEvaluatedKey;
    } while (start);
    return out;
  },
  // Background work: one item per thread, TTL one day after the deadline (a watch the poller never ended goes).
  async putBgWatch(w) {
    await doc.send(new PutCommand({ TableName: TABLE, Item: { pk: 'BGWATCH', sk: w.thread, ...w, ttl: Math.floor(w.deadline / 1000) + 86_400 } }));
  },
  async listBgWatches() {
    const out: StoredBgWatch[] = [];
    let start: Record<string, any> | undefined;
    do {
      const r = await doc.send(new QueryCommand({ TableName: TABLE, KeyConditionExpression: 'pk = :p', ExpressionAttributeValues: { ':p': 'BGWATCH' }, ExclusiveStartKey: start }));
      for (const { pk, sk, ttl: _, ...w } of r.Items ?? []) out.push(w as StoredBgWatch);
      start = r.LastEvaluatedKey;
    } while (start);
    return out;
  },
  async deleteBgWatch(thread, deadline) {
    try {
      await doc.send(new DeleteCommand({ TableName: TABLE, Key: { pk: 'BGWATCH', sk: thread }, ...(deadline === null ? {} : { ConditionExpression: 'deadline = :d', ExpressionAttributeValues: { ':d': deadline } }) }));
      return true;
    } catch (e: any) { if (failed(e)) return false; throw e; }
  },
  async deleteCiWatch(thread, repo, sha) {
    try {
      await doc.send(new DeleteCommand({ TableName: TABLE, Key: { pk: 'CIWATCH', sk: `${thread}#${repo}` }, ConditionExpression: 'sha = :s', ExpressionAttributeValues: { ':s': sha } }));
      return true;
    } catch (e: any) { if (failed(e)) return false; throw e; }
  },
  async issueThreads(space) {
    const out: Record<string, string> = {};
    let start: Record<string, any> | undefined;
    do {
      const r = await doc.send(new QueryCommand({ TableName: TABLE, KeyConditionExpression: 'pk = :p AND begins_with(sk, :i)', ExclusiveStartKey: start,
        ExpressionAttributeValues: { ':p': `SPACE#${space}`, ':i': 'ISSUE#' } }));
      for (const i of r.Items ?? []) out[String(i.sk).slice(6)] = String(i.thread);
      start = r.LastEvaluatedKey;
    } while (start);
    return out;
  },
  async claimIssueThread(space, key, thread) {
    // One thread per issue: the first writer wins (concurrent polls, or the → Issue job), the others read its id.
    try {
      await doc.send(new PutCommand({ TableName: TABLE, Item: { pk: `SPACE#${space}`, sk: `ISSUE#${key}`, thread }, ConditionExpression: 'attribute_not_exists(pk)' }));
      return thread;
    } catch (e: any) {
      if (e?.name !== 'ConditionalCheckFailedException') throw e;
      const r = await doc.send(new GetCommand({ TableName: TABLE, Key: { pk: `SPACE#${space}`, sk: `ISSUE#${key}` }, ConsistentRead: true }));
      return String(r.Item!.thread);
    }
  },
  async getSummary(thread) { const i = await get(`THREAD#${thread}`, 'SUMMARY'); if (!i) return null; const { pk, sk, ...s } = i; return s as ThreadSummary },
  async putSummary(s) {
    try {
      await doc.send(new PutCommand({ TableName: TABLE, Item: { pk: `THREAD#${s.thread}`, sk: 'SUMMARY', ...s },
        ConditionExpression: 'attribute_not_exists(#at) OR #at < :at', ExpressionAttributeNames: { '#at': 'at' }, ExpressionAttributeValues: { ':at': s.at } }));
      return true;
    } catch (e: any) { if (e?.name === 'ConditionalCheckFailedException') return false; throw e; }
  },
  async putAttachment(a) { await doc.send(new PutCommand({ TableName: TABLE, Item: { pk: `ATT#${a.id}`, sk: 'META', ...a } })) },
  async getAttachments(ids) {
    if (!ids.length) return [];
    const r = await doc.send(new BatchGetCommand({ RequestItems: { [TABLE]: { Keys: [...new Set(ids)].map(i => ({ pk: `ATT#${i}`, sk: 'META' })) } } }));
    return (r.Responses?.[TABLE] ?? []).map(({ pk, sk, ...a }) => a as Attachment);
  },
  async claimAttachment(attId, msg) {
    try {
      await doc.send(new UpdateCommand({ TableName: TABLE, Key: { pk: `ATT#${attId}`, sk: 'META' }, UpdateExpression: 'SET msg = :m',
        ConditionExpression: 'attribute_exists(pk) AND (attribute_not_exists(msg) OR msg = :m)', ExpressionAttributeValues: { ':m': msg } }));
      return true;
    } catch (e: any) { if (e?.name === 'ConditionalCheckFailedException') return false; throw e; }
  },
  async getGithub(space) { const i = await get(`SPACE#${space}`, 'GITHUB'); if (!i) return null; const { pk, sk, ...s } = i; return s as GhSnapshot },
  async putGithub(s) { await doc.send(new PutCommand({ TableName: TABLE, Item: { pk: `SPACE#${s.space}`, sk: 'GITHUB', ...s } })) },
  // Personal pins: USER#<sub> / PIN#<thread>, kept even when unpinned (on: false) for the `at` guard.
  async listPins(user, space) {
    const r = await doc.send(new QueryCommand({ TableName: TABLE, KeyConditionExpression: 'pk = :p AND begins_with(sk, :k)', FilterExpression: '#s = :s',
      ExpressionAttributeNames: { '#s': 'space' }, ExpressionAttributeValues: { ':p': `USER#${user}`, ':k': 'PIN#', ':s': space } }));
    return (r.Items ?? []).map(i => ({ thread: i.thread, space: i.space, on: i.on, at: i.at }));
  },
  async putPin(user, p) {
    try {
      await doc.send(new PutCommand({ TableName: TABLE, Item: { pk: `USER#${user}`, sk: `PIN#${p.thread}`, ...p },
        ConditionExpression: 'attribute_not_exists(#at) OR #at < :at', ExpressionAttributeNames: { '#at': 'at' }, ExpressionAttributeValues: { ':at': p.at } }));
      return true;
    } catch (e: any) { if (e?.name === 'ConditionalCheckFailedException') return false; throw e; }
  },
  // Personal mutes: SPACE#<space> / MUTE#<sub> {user, on, at}, kept when turned off for the `at` guard (same as pins). In
  // the space's partition, so the notifications of one message read them with ONE query (begins_with), and a person's
  // mutes of their spaces with one batch get at connect.
  async mutedIn(space) {
    const r = await doc.send(new QueryCommand({ TableName: TABLE, KeyConditionExpression: 'pk = :p AND begins_with(sk, :k)',
      ExpressionAttributeValues: { ':p': `SPACE#${space}`, ':k': 'MUTE#' } }));
    return (r.Items ?? []).filter(i => i.on === true && typeof i.user === 'string').map(i => i.user as string);
  },
  async mutesOf(user, spaces) {
    return (await batchGet([...new Set(spaces)].map(s => ({ pk: `SPACE#${s}`, sk: `MUTE#${user}` })))).map(i => ({ space: i.space, on: i.on === true, at: i.at }));
  },
  async putMute(user, m) {
    try {
      await doc.send(new PutCommand({ TableName: TABLE, Item: { pk: `SPACE#${m.space}`, sk: `MUTE#${user}`, user, ...m },
        ConditionExpression: 'attribute_not_exists(#at) OR #at < :at', ExpressionAttributeNames: { '#at': 'at' }, ExpressionAttributeValues: { ':at': m.at } }));
      return true;
    } catch (e: any) { if (e?.name === 'ConditionalCheckFailedException') return false; throw e; }
  },
  // Personal read marks: USER#<sub> / SEEN#<space>#<thread> {at}, only moving forward (same guard as pins).
  async seenMarks(user, space, threads) {
    return (await batchGet([...new Set(threads)].map(t => ({ pk: `USER#${user}`, sk: `SEEN#${space}#${t}` })))).map(i => ({ thread: i.thread, at: i.at }));
  },
  async putSeen(user, space, m) {
    try {
      await doc.send(new PutCommand({ TableName: TABLE, Item: { pk: `USER#${user}`, sk: `SEEN#${space}#${m.thread}`, space, thread: m.thread, at: m.at },
        ConditionExpression: 'attribute_not_exists(#at) OR #at < :at', ExpressionAttributeNames: { '#at': 'at' }, ExpressionAttributeValues: { ':at': m.at } }));
      return true;
    } catch (e: any) { if (e?.name === 'ConditionalCheckFailedException') return false; throw e; }
  },
  // Web Push devices: USER#<sub> / PUSH#<id> (id = hash of the endpoint). TTL refreshed at every connection (the client
  // re-subscribes while alerts are on): a device nobody opens for PUSH_TTL_S disappears by itself.
  async listPushes(user) {
    const r = await doc.send(new QueryCommand({ TableName: TABLE, KeyConditionExpression: 'pk = :p AND begins_with(sk, :k)', ExpressionAttributeValues: { ':p': `USER#${user}`, ':k': 'PUSH#' } }));
    return (r.Items ?? []).map(i => ({ id: i.id, endpoint: i.endpoint, keys: { p256dh: i.p256dh, auth: i.auth }, lang: i.lang, at: i.at }));
  },
  async putPush(user, x) {
    await doc.send(new PutCommand({ TableName: TABLE, Item: { pk: `USER#${user}`, sk: `PUSH#${x.id}`, id: x.id, endpoint: x.endpoint, p256dh: x.keys.p256dh, auth: x.keys.auth,
      lang: x.lang, at: x.at, ttl: Math.floor(x.at / 1000) + PUSH_TTL_S } }));
  },
  async deletePush(user, id) { await doc.send(new DeleteCommand({ TableName: TABLE, Key: { pk: `USER#${user}`, sk: `PUSH#${id}` } })) },
  async putPreview(x) {
    await doc.send(new PutCommand({ TableName: TABLE, Item: { pk: `PREVIEW#${x.session}`, sk: 'META', ...x, ttl: Math.floor(x.at / 1000) + PREVIEW_SESSION_S } }));
  },
  async getPreview(session) { const i = await get(`PREVIEW#${session}`, 'META'); if (!i) return null; const { pk, sk, ttl: _, ...p } = i; return p as StoredPreview },
  async deletePreview(session) { await doc.send(new DeleteCommand({ TableName: TABLE, Key: { pk: `PREVIEW#${session}`, sk: 'META' } })) },
  // Visitor link: kept an hour past its deadline (the table's TTL), read by the $connect authorizer too.
  async putVisitor(x) {
    await doc.send(new PutCommand({ TableName: TABLE, Item: { pk: `VISITOR#${x.msg}`, sk: 'META', ...x, ttl: Math.floor(x.until / 1000) + 3600 } }));
  },
  async getVisitor(msg) { const i = await get(`VISITOR#${msg}`, 'META'); if (!i) return null; const { pk, sk, ttl: _, ...v } = i; return v as StoredVisitor },
  async deleteVisitor(msg) { await doc.send(new DeleteCommand({ TableName: TABLE, Key: { pk: `VISITOR#${msg}`, sk: 'META' } })) },
  // Reactions: THREAD#<thread> / REACT#<msg>#<emoji>#<user>, same partition as the messages (one query for the history).
  async listReactions(thread) {
    const r = await doc.send(new QueryCommand({ TableName: TABLE, KeyConditionExpression: 'pk = :p AND begins_with(sk, :k)', ExpressionAttributeValues: { ':p': `THREAD#${thread}`, ':k': 'REACT#' } }));
    return (r.Items ?? []).map(i => ({ thread: i.thread, msg: i.msg, emoji: i.emoji, user: i.user, on: i.on, at: i.at, hubAt: i.hubAt }));
  },
  async putReaction(x) {
    try {
      await doc.send(new PutCommand({ TableName: TABLE, Item: { pk: `THREAD#${x.thread}`, sk: `REACT#${x.msg}#${x.emoji}#${x.user}`, ...x },
        ConditionExpression: 'attribute_not_exists(#at) OR #at < :at', ExpressionAttributeNames: { '#at': 'at' }, ExpressionAttributeValues: { ':at': x.at } }));
      return true;
    } catch (e: any) { if (e?.name === 'ConditionalCheckFailedException') return false; throw e; }
  },
  async putFlowRecord(r) {
    await doc.send(new PutCommand({ TableName: TABLE, Item: { pk: `SPACE#${r.space}`, sk: `FLOWREC#${String(r.start).padStart(10, '0')}#${r.agent}`, ...r } }));
  },
  async listFlowRecords(space, limit) {
    const r = await doc.send(new QueryCommand({ TableName: TABLE, KeyConditionExpression: 'pk = :p AND begins_with(sk, :f)', ScanIndexForward: false, Limit: limit,
      ExpressionAttributeValues: { ':p': `SPACE#${space}`, ':f': 'FLOWREC#' } }));
    // Explicit list (a field added to FlowRecord must be added here, see the briefling skill « flow »).
    return (r.Items ?? []).map(i => ({ space: i.space, agent: i.agent, thread: i.thread ?? null, ref: i.ref, key: i.key, at: i.at, outcome: i.outcome,
      kind: i.kind ?? null, trigger: i.trigger, start: i.start, end: i.end, retries: i.retries, runs: i.runs, reviews: i.reviews, cost: i.cost ?? null }));
  },
  // One JSON text per agent (`data`): the report is checked whole by flowstate.ts, no attribute list to keep in sync.
  async listFlowStates(space) {
    const r = await doc.send(new QueryCommand({ TableName: TABLE, KeyConditionExpression: 'pk = :p AND begins_with(sk, :f)',
      ExpressionAttributeValues: { ':p': `SPACE#${space}`, ':f': 'FLOWLIVE#' } }));
    return (r.Items ?? []).map(i => JSON.parse(i.data));
  },
  async putFlowState(space, st) {
    await doc.send(new PutCommand({ TableName: TABLE, Item: { pk: `SPACE#${space}`, sk: `FLOWLIVE#${st.agent}`, data: JSON.stringify(st) } }));
  },
  // Pilot of a flow agent: JSON text `data` (no attribute list to keep in sync) + `st`, `hash`, `exp` for the conditions.
  async listFlowPilots(space) {
    const r = await doc.send(new QueryCommand({ TableName: TABLE, KeyConditionExpression: 'pk = :p AND begins_with(sk, :f)',
      ExpressionAttributeValues: { ':p': `SPACE#${space}`, ':f': 'FLOWPILOT#' } }));
    return (r.Items ?? []).map(i => JSON.parse(i.data));
  },
  async putFlowPilot(space, p) {
    try {
      await doc.send(new PutCommand({ TableName: TABLE, Item: { pk: `SPACE#${space}`, sk: `FLOWPILOT#${p.agent}`, data: JSON.stringify(p), st: p.state, hash: p.hash, exp: p.expiresAt ?? 0 },
        ConditionExpression: 'attribute_not_exists(pk) OR st <> :piloted', ExpressionAttributeValues: { ':piloted': 'piloted' } }));
      return true;
    } catch (e: any) { if (e?.name === 'ConditionalCheckFailedException') return false; throw e; }
  },
  async claimFlowPilot(space, agent, hash, now, next) {
    try {
      await doc.send(new PutCommand({ TableName: TABLE, Item: { pk: `SPACE#${space}`, sk: `FLOWPILOT#${agent}`, data: JSON.stringify(next), st: next.state, hash: next.hash, exp: 0 },
        ConditionExpression: 'st = :pending AND #h = :h AND #exp > :now', ExpressionAttributeNames: { '#h': 'hash', '#exp': 'exp' },
        ExpressionAttributeValues: { ':pending': 'pending', ':h': hash, ':now': now } }));
      return true;
    } catch (e: any) { if (e?.name === 'ConditionalCheckFailedException') return false; throw e; }
  },
  async deleteFlowPilot(space, agent) {
    await doc.send(new DeleteCommand({ TableName: TABLE, Key: { pk: `SPACE#${space}`, sk: `FLOWPILOT#${agent}` } }));
  },
  async claimFlowWake(space, now, windowMs) {
    try {
      await doc.send(new PutCommand({ TableName: TABLE, Item: { pk: `SPACE#${space}`, sk: 'FLOWWAKE', at: now },
        ConditionExpression: 'attribute_not_exists(pk) OR #at <= :cut', ExpressionAttributeNames: { '#at': 'at' }, ExpressionAttributeValues: { ':cut': now - windowMs } }));
      return true;
    } catch (e: any) { if (e?.name === 'ConditionalCheckFailedException') return false; throw e; }
  },
  async countAgentTopic(space, agent, day, cap) {
    try {
      await doc.send(new UpdateCommand({ TableName: TABLE, Key: { pk: `SPACE#${space}`, sk: `AGENTTOPICS#${agent}#${day}` },
        UpdateExpression: 'ADD #n :one SET #ttl = :ttl', ConditionExpression: 'attribute_not_exists(#n) OR #n < :cap',
        ExpressionAttributeNames: { '#n': 'n', '#ttl': 'ttl' }, ExpressionAttributeValues: { ':one': 1, ':cap': cap, ':ttl': Math.floor(Date.now() / 1000) + 2 * 86400 } }));
      return true;
    } catch (e: any) { if (e?.name === 'ConditionalCheckFailedException') return false; throw e; }
  },
  // Routines: JSON text `data` (no attribute list to keep in sync) + `version` for the condition.
  async listRoutines(space) {
    const r = await doc.send(new QueryCommand({ TableName: TABLE, KeyConditionExpression: 'pk = :p AND begins_with(sk, :r)',
      ExpressionAttributeValues: { ':p': `SPACE#${space}`, ':r': 'ROUTINE#' } }));
    return (r.Items ?? []).map(i => JSON.parse(i.data));
  },
  async putRoutine(space, x, expected) {
    try {
      await doc.send(new PutCommand({ TableName: TABLE, Item: { pk: `SPACE#${space}`, sk: `ROUTINE#${x.id}`, data: JSON.stringify(x), version: x.version },
        ...(expected === null ? { ConditionExpression: 'attribute_not_exists(pk)' }
          : { ConditionExpression: '#v = :v', ExpressionAttributeNames: { '#v': 'version' }, ExpressionAttributeValues: { ':v': expected } }) }));
      return true;
    } catch (e: any) { if (e?.name === 'ConditionalCheckFailedException') return false; throw e; }
  },
  async deleteRoutine(space, id) {
    await doc.send(new DeleteCommand({ TableName: TABLE, Key: { pk: `SPACE#${space}`, sk: `ROUTINE#${id}` } }));
  },
  // Module records (hub/src/modules.ts): same shape as routines, every page read.
  async listItems(space, kind) {
    const out: any[] = [];
    let start: Record<string, any> | undefined;
    do {
      const r = await doc.send(new QueryCommand({ TableName: TABLE, KeyConditionExpression: 'pk = :p AND begins_with(sk, :r)',
        ExpressionAttributeValues: { ':p': `SPACE#${space}`, ':r': `${kind}#` }, ExclusiveStartKey: start }));
      out.push(...(r.Items ?? []).map(i => JSON.parse(i.data)));
      start = r.LastEvaluatedKey;
    } while (start);
    return out;
  },
  async getItem(space, kind, id) {
    const i = await get(`SPACE#${space}`, `${kind}#${id}`);
    return i ? JSON.parse(i.data) : null;
  },
  async putItem(space, kind, x, expected) {
    try {
      await doc.send(new PutCommand({ TableName: TABLE, Item: { pk: `SPACE#${space}`, sk: `${kind}#${x.id}`, data: JSON.stringify(x), version: x.version },
        ...(expected === null ? { ConditionExpression: 'attribute_not_exists(pk)' }
          : { ConditionExpression: '#v = :v', ExpressionAttributeNames: { '#v': 'version' }, ExpressionAttributeValues: { ':v': expected } }) }));
      return true;
    } catch (e: any) { if (e?.name === 'ConditionalCheckFailedException') return false; throw e; }
  },
  async deleteItem(space, kind, id) {
    await doc.send(new DeleteCommand({ TableName: TABLE, Key: { pk: `SPACE#${space}`, sk: `${kind}#${id}` } }));
  },
  // Applets: same shape as routines (hub/src/applets.ts).
  async listApplets(space) {
    const r = await doc.send(new QueryCommand({ TableName: TABLE, KeyConditionExpression: 'pk = :p AND begins_with(sk, :r)',
      ExpressionAttributeValues: { ':p': `SPACE#${space}`, ':r': 'APPLET#' } }));
    return (r.Items ?? []).map(i => JSON.parse(i.data));
  },
  async putApplet(space, x, expected) {
    try {
      await doc.send(new PutCommand({ TableName: TABLE, Item: { pk: `SPACE#${space}`, sk: `APPLET#${x.id}`, data: JSON.stringify(x), version: x.version },
        ...(expected === null ? { ConditionExpression: 'attribute_not_exists(pk)' }
          : { ConditionExpression: '#v = :v', ExpressionAttributeNames: { '#v': 'version' }, ExpressionAttributeValues: { ':v': expected } }) }));
      return true;
    } catch (e: any) { if (e?.name === 'ConditionalCheckFailedException') return false; throw e; }
  },
  async deleteApplet(space, id) {
    await doc.send(new DeleteCommand({ TableName: TABLE, Key: { pk: `SPACE#${space}`, sk: `APPLET#${id}` } }));
  },
  // Mail exchanges: `EXCH#<space>`, JSON `data` + `version` like signals (hub/src/exchanges.ts).
  async listCorrespondents(space) { return (await queryExch(space, 'C#')).map(i => JSON.parse(i.data)) },
  async putCorrespondent(c, expected) { return putVersioned(`EXCH#${c.space}`, `C#${c.id}`, c, expected) },
  async deleteCorrespondent(space, id) { await doc.send(new DeleteCommand({ TableName: TABLE, Key: { pk: `EXCH#${space}`, sk: `C#${id}` } })) },
  async listExchanges(space) { return (await queryExch(space, 'X#')).map(i => JSON.parse(i.data)) },
  async getExchange(space, id) { const i = await get(`EXCH#${space}`, `X#${id}`); return i ? JSON.parse(i.data) : null },
  async putExchange(x, expected) { return putVersioned(`EXCH#${x.space}`, `X#${x.id}`, x, expected) },
  async listExchangeMails(space, exchange) { return (await queryExch(space, `M#${exchange}#`)).map(i => JSON.parse(i.data)) },
  async getMailOwner(space, mail) { const i = await get(`EXCH#${space}`, `MID#${mail}`); return i ? i.exchange as string : null },
  async putExchangeMail(m) {
    try {
      await doc.send(new TransactWriteCommand({ TransactItems: [
        { Put: { TableName: TABLE, Item: { pk: `EXCH#${m.space}`, sk: `MID#${m.id}`, exchange: m.exchange }, ConditionExpression: 'attribute_not_exists(pk)' } },
        { Put: { TableName: TABLE, Item: { pk: `EXCH#${m.space}`, sk: mailSk(m.exchange, m.date, m.id), data: JSON.stringify(m) } } },
      ] }));
      return true;
    } catch (e: any) { if (e?.name === 'TransactionCanceledException' && String(e?.message).includes('ConditionalCheckFailed')) return false; throw e; }
  },
  async getExchangeConfig(space) { const i = await get(`EXCH#${space}`, 'CFG'); return i ? JSON.parse(i.data) : null },
  async putExchangeConfig(c, expected) { return putVersioned(`EXCH#${c.space}`, 'CFG', c, expected) },
  async deleteExchange(space, id, mails) {
    const keys = [`X#${id}`, ...mails.flatMap(m => [mailSk(id, m.date, m.id), `MID#${m.id}`])];
    for (const sk of keys) await doc.send(new DeleteCommand({ TableName: TABLE, Key: { pk: `EXCH#${space}`, sk } }));
  },
  // Radar signals: same shape as routines (JSON `data` + `version`); listed whole then sorted (a few hundred at most).
  async listSignals(space, limit) {
    const all: any[] = [];
    let start: Record<string, any> | undefined;
    do {
      const r = await doc.send(new QueryCommand({ TableName: TABLE, KeyConditionExpression: 'pk = :p AND begins_with(sk, :s)',
        ExpressionAttributeValues: { ':p': `SPACE#${space}`, ':s': 'SIGNAL#' }, ExclusiveStartKey: start }));
      for (const i of r.Items ?? []) all.push(JSON.parse(i.data));
      start = r.LastEvaluatedKey;
    } while (start);
    return all.sort((a, b) => b.lastAt - a.lastAt || a.id.localeCompare(b.id)).slice(0, limit);
  },
  async getSignal(space, id) { const i = await get(`SPACE#${space}`, `SIGNAL#${id}`); return i ? JSON.parse(i.data) : null },
  async putSignal(x, expected) {
    try {
      await doc.send(new PutCommand({ TableName: TABLE, Item: { pk: `SPACE#${x.space}`, sk: `SIGNAL#${x.id}`, data: JSON.stringify(x), version: x.version },
        ...(expected === null ? { ConditionExpression: 'attribute_not_exists(pk)' }
          : { ConditionExpression: '#v = :v', ExpressionAttributeNames: { '#v': 'version' }, ExpressionAttributeValues: { ':v': expected } }) }));
      return true;
    } catch (e: any) { if (e?.name === 'ConditionalCheckFailedException') return false; throw e; }
  },
  // The agent's hand (one thread at a time): SPACE#<space> / LOCK#<agent>, `version` guard like threads.
  async getLock(space, agent) { const i = await get(`SPACE#${space}`, `LOCK#${agent}`); if (!i) return null; const { pk, sk, ...l } = i; return l as StoredLock },
  async putLock(lock, expected) {
    try {
      await doc.send(new PutCommand({
        TableName: TABLE, Item: { pk: `SPACE#${lock.space}`, sk: `LOCK#${lock.agent}`, ...lock },
        ...(expected === null ? { ConditionExpression: 'attribute_not_exists(pk)' }
          : { ConditionExpression: '#v = :v', ExpressionAttributeNames: { '#v': 'version' }, ExpressionAttributeValues: { ':v': expected } }),
      }));
      return true;
    } catch (e: any) { if (e?.name === 'ConditionalCheckFailedException') return false; throw e; }
  },
  async listLocks(space) {
    const r = await doc.send(new QueryCommand({ TableName: TABLE, KeyConditionExpression: 'pk = :p AND begins_with(sk, :l)', ExpressionAttributeValues: { ':p': `SPACE#${space}`, ':l': 'LOCK#' } }));
    return (r.Items ?? []).map(({ pk, sk, ...l }) => l as StoredLock);
  },
  // Shared resources of a space: SPACE#<space> / RES#<resource>, `version` guard like the agent's hand.
  async getResource(space, resource) { const i = await get(`SPACE#${space}`, `RES#${resource}`); if (!i) return null; const { pk, sk, ...l } = i; return l as StoredResource },
  async putResource(res, expected) {
    try {
      await doc.send(new PutCommand({
        TableName: TABLE, Item: { pk: `SPACE#${res.space}`, sk: `RES#${res.resource}`, ...res },
        ...(expected === null ? { ConditionExpression: 'attribute_not_exists(pk)' }
          : { ConditionExpression: '#v = :v', ExpressionAttributeNames: { '#v': 'version' }, ExpressionAttributeValues: { ':v': expected } }),
      }));
      return true;
    } catch (e: any) { if (e?.name === 'ConditionalCheckFailedException') return false; throw e; }
  },
  async listResources(space) {
    const r = await doc.send(new QueryCommand({ TableName: TABLE, KeyConditionExpression: 'pk = :p AND begins_with(sk, :l)', ExpressionAttributeValues: { ':p': `SPACE#${space}`, ':l': 'RES#' } }));
    return (r.Items ?? []).map(({ pk, sk, ...l }) => l as StoredResource);
  },
  // Project memory: MEM#<space> / <entry id>, whole item written (Put), `version` guard.
  async listMemory(space) {
    const out: MemoryEntry[] = [];
    let start: Record<string, any> | undefined;
    do {
      const r = await doc.send(new QueryCommand({ TableName: TABLE, KeyConditionExpression: 'pk = :p', ExpressionAttributeValues: { ':p': `MEM#${space}` }, ExclusiveStartKey: start }));
      for (const { pk, sk, ...e } of r.Items ?? []) out.push(e as MemoryEntry);
      start = r.LastEvaluatedKey;
    } while (start);
    return out;
  },
  async getMemory(space, id) { const i = await get(`MEM#${space}`, id); if (!i) return null; const { pk, sk, ...e } = i; return e as MemoryEntry },
  async putMemory(e, expected) {
    try {
      await doc.send(new PutCommand({
        TableName: TABLE, Item: { pk: `MEM#${e.space}`, sk: e.id, ...e },
        ...(expected === null ? { ConditionExpression: 'attribute_not_exists(pk)' }
          : { ConditionExpression: '#v = :v', ExpressionAttributeNames: { '#v': 'version' }, ExpressionAttributeValues: { ':v': expected } }),
      }));
      return true;
    } catch (err: any) { if (err?.name === 'ConditionalCheckFailedException') return false; throw err; }
  },
  async addMemoryPending(space, delta, arrived) {
    const r = await doc.send(new UpdateCommand({ TableName: TABLE, Key: { pk: `SPACE#${space}`, sk: 'META' },
      UpdateExpression: 'ADD #p :d, #a :a', ConditionExpression: 'attribute_exists(pk)',
      ExpressionAttributeNames: { '#p': 'memPending', '#a': 'memArrivals' }, ExpressionAttributeValues: { ':d': delta, ':a': arrived ? 1 : 0 }, ReturnValues: 'UPDATED_NEW' }));
    return { pending: Number(r.Attributes?.memPending ?? 0), arrivals: Number(r.Attributes?.memArrivals ?? 0) };
  },
  async setMemoryPending(space, n) {
    await doc.send(new UpdateCommand({ TableName: TABLE, Key: { pk: `SPACE#${space}`, sk: 'META' }, UpdateExpression: 'SET #p = :n',
      ConditionExpression: 'attribute_exists(pk)', ExpressionAttributeNames: { '#p': 'memPending' }, ExpressionAttributeValues: { ':n': n } }));
  },
  // Settings › Radar: JSON `data` + `version`, like the routines.
  async getRadarConfig(space) { const i = await get(`SPACE#${space}`, 'RADARCFG'); return i ? JSON.parse(i.data) : null },
  async putRadarConfig(c, expected) { return await putJson(`SPACE#${c.space}`, 'RADARCFG', c, expected) },
  // Spend of hidden turns, one row per UTC day / origin / agent (read-modify-write under `version`).
  async getHiddenUsage(space, day, origin, agent) { const i = await get(`SPACE#${space}`, `HIDDENCOST#${day}#${origin}#${agent}`); return i ? JSON.parse(i.data) : null },
  async putHiddenUsage(x, expected) { return await putJson(`SPACE#${x.space}`, `HIDDENCOST#${x.day}#${x.origin}#${x.agent}`, x, expected) },
  async listHiddenUsage(space, fromDay) {
    const all: HiddenUsage[] = [];
    let start: Record<string, any> | undefined;
    do {
      const r = await doc.send(new QueryCommand({ TableName: TABLE, KeyConditionExpression: 'pk = :p AND sk BETWEEN :a AND :b',
        ExpressionAttributeValues: { ':p': `SPACE#${space}`, ':a': `HIDDENCOST#${fromDay}`, ':b': 'HIDDENCOST#\uffff' }, ExclusiveStartKey: start }));
      for (const i of r.Items ?? []) all.push(JSON.parse(i.data));
      start = r.LastEvaluatedKey;
    } while (start);
    return all;
  },
  async getMemoryConfig(space) { const i = await get(`SPACE#${space}`, 'MEMCFG'); if (!i) return null; const { pk, sk, ...c } = i; return c as MemoryConfig },
  async putMemoryConfig(c, expected) {
    try {
      await doc.send(new PutCommand({
        TableName: TABLE, Item: { pk: `SPACE#${c.space}`, sk: 'MEMCFG', ...c },
        ...(expected === null ? { ConditionExpression: 'attribute_not_exists(pk)' }
          : { ConditionExpression: '#v = :v', ExpressionAttributeNames: { '#v': 'version' }, ExpressionAttributeValues: { ':v': expected } }),
      }));
      return true;
    } catch (err: any) { if (err?.name === 'ConditionalCheckFailedException') return false; throw err; }
  },
  // Tag vocabulary of the project memory: SPACE#<space> / MEMTAGS (aliases + waiting merges), optimistic like MEMCFG.
  async getMemoryVocab(space) { const i = await get(`SPACE#${space}`, 'MEMTAGS'); return i ? vocabIn(space, i) : null },
  async putMemoryVocab(v, expected) {
    try {
      await doc.send(new PutCommand({
        TableName: TABLE, Item: { pk: `SPACE#${v.space}`, sk: 'MEMTAGS', space: v.space, aliases: v.aliases, merges: v.merges, ...(v.created?.length ? { created: v.created } : {}), ...(v.seen && Object.keys(v.seen).length ? { seen: v.seen } : {}), version: v.version },
        ...(expected === null ? { ConditionExpression: 'attribute_not_exists(pk)' }
          : { ConditionExpression: '#v = :v', ExpressionAttributeNames: { '#v': 'version' }, ExpressionAttributeValues: { ':v': expected } }),
      }));
      return true;
    } catch (err: any) { if (err?.name === 'ConditionalCheckFailedException') return false; throw err; }
  },
  // Flow editor: SPACE#<space> / FLOWCFG#<version, 8 digits> (sorts by version), def kept as its JSON text (exact,
  // no marshalling of empty strings or maps). A version is written once (conditional put), never updated.
  async listFlowVersions(space, limit) {
    const r = await doc.send(new QueryCommand({ TableName: TABLE, KeyConditionExpression: 'pk = :p AND begins_with(sk, :f)',
      ExpressionAttributeValues: { ':p': `SPACE#${space}`, ':f': 'FLOWCFG#' }, ScanIndexForward: false, Limit: limit,
      ProjectionExpression: '#v, #b, #a, sha, #c', ExpressionAttributeNames: { '#v': 'version', '#b': 'by', '#a': 'at', '#c': 'commit' } }));
    return (r.Items ?? []).map(i => ({ version: i.version, by: i.by, at: i.at, sha: i.sha, ...(i.commit ? { commit: i.commit } : {}) }));
  },
  async getFlowVersion(space, version) {
    const i = version === null
      ? (await doc.send(new QueryCommand({ TableName: TABLE, KeyConditionExpression: 'pk = :p AND begins_with(sk, :f)',
        ExpressionAttributeValues: { ':p': `SPACE#${space}`, ':f': 'FLOWCFG#' }, ScanIndexForward: false, Limit: 1 }))).Items?.[0]
      : await get(`SPACE#${space}`, flowSk(version));
    // team: since slice 3 (older versions have none: an empty team).
    return i ? { version: i.version, by: i.by, at: i.at, sha: i.sha, def: JSON.parse(i.def), team: i.team ? JSON.parse(i.team) : structuredClone(EMPTY_TEAM),
      ...(i.source ? { source: JSON.parse(i.source) } : {}), ...(i.commit ? { commit: i.commit } : {}) } : null;
  },
  async putFlowVersion(space, v) {
    try {
      // approved: the Merge button's column (flowColumns falls back to the def for versions saved without it).
      await doc.send(new PutCommand({ TableName: TABLE, ConditionExpression: 'attribute_not_exists(pk)',
        Item: { pk: `SPACE#${space}`, sk: flowSk(v.version), version: v.version, by: v.by, at: v.at, sha: v.sha, def: JSON.stringify(v.def), team: JSON.stringify(v.team),
          approved: approvedColumn(v.def) ?? '', ...(v.source ? { source: JSON.stringify(v.source) } : {}), ...(v.commit ? { commit: v.commit } : {}) } }));
      return true;
    } catch (err: any) { if (err?.name === 'ConditionalCheckFailedException') return false; throw err; }
  },
  async flowColumns(space) {
    const r = await doc.send(new QueryCommand({ TableName: TABLE, KeyConditionExpression: 'pk = :p AND begins_with(sk, :f)',
      ExpressionAttributeValues: { ':p': `SPACE#${space}`, ':f': 'FLOWCFG#' }, ScanIndexForward: false, Limit: 1, ProjectionExpression: 'approved, def' }));
    const i = r.Items?.[0];
    if (!i) return null;
    // Versions saved before slice 3 have no `approved`: read it from their def.
    const def = JSON.parse(i.def);
    return { approved: typeof i.approved === 'string' && i.approved ? i.approved : approvedColumn(def), work: workColumns(def) };
  },
  async listFlowStatus(space) {
    const r = await doc.send(new QueryCommand({ TableName: TABLE, KeyConditionExpression: 'pk = :p AND begins_with(sk, :f)',
      ExpressionAttributeValues: { ':p': `SPACE#${space}`, ':f': 'FLOWSTAT#' } }));
    return (r.Items ?? []).map(i => ({ agent: i.agent, version: i.version, sha: i.sha, ok: i.ok, ...(i.error ? { error: i.error } : {}), ...(i.commit ? { commit: i.commit } : {}), at: i.at }));
  },
  async getFlowGit(space) {
    const i = await get(`SPACE#${space}`, 'FLOWGIT');
    return i ? JSON.parse(i.data) : null;
  },
  async putFlowGit(space, g) {
    // One JSON text: file texts kept exactly (empty strings included), ~64 KB at most.
    await doc.send(new PutCommand({ TableName: TABLE, Item: { pk: `SPACE#${space}`, sk: 'FLOWGIT', head: g.head, data: JSON.stringify(g) } }));
  },
  async putFlowStatus(space, st) {
    await doc.send(new PutCommand({ TableName: TABLE, Item: { pk: `SPACE#${space}`, sk: `FLOWSTAT#${st.agent}`, ...st } }));
  },
  async deleteMessage(thread, id) { await doc.send(new DeleteCommand({ TableName: TABLE, Key: { pk: `THREAD#${thread}`, sk: `MSG#${id}` } })) },
  async setSubtopic(thread, id, topic) {
    try {
      await doc.send(new UpdateCommand({ TableName: TABLE, Key: { pk: `THREAD#${thread}`, sk: `MSG#${id}` }, UpdateExpression: 'SET subtopic = :t',
        ConditionExpression: 'attribute_exists(pk) AND attribute_not_exists(subtopic)', ExpressionAttributeValues: { ':t': topic } }));
      return true;
    } catch (e: any) { if (e?.name === 'ConditionalCheckFailedException') return false; throw e; }
  },
  async eraseMessage(thread, id, rev, deleted) {
    try {
      const r = await doc.send(new UpdateCommand({ TableName: TABLE, Key: { pk: `THREAD#${thread}`, sk: `MSG#${id}` },
        UpdateExpression: 'SET #t = :e, #rev = :rev, deleted = :d REMOVE files, edited',
        ConditionExpression: 'attribute_exists(sk) AND (#rev = :old OR (attribute_not_exists(#rev) AND :old = :zero))',
        ExpressionAttributeNames: { '#t': 'text', '#rev': 'rev' },
        ExpressionAttributeValues: { ':e': '', ':rev': rev, ':old': rev - 1, ':zero': 0, ':d': deleted }, ReturnValues: 'ALL_NEW' }));
      const { pk, sk, ...m } = r.Attributes as any;
      if (m.ask === null) delete m.ask; // like upsertMessage
      return m as Message;
    } catch (e: any) { if (e?.name === 'ConditionalCheckFailedException') return null; throw e; }
  },
  async getMessage(thread, id) { const i = await get(`THREAD#${thread}`, `MSG#${id}`); if (!i) return null; const { pk, sk, ...m } = i; return m as Message },
  async lastMessages(thread, n, before) {
    // DynamoDB refuses a key attribute in a FilterExpression: `before` is a key range (BETWEEN is inclusive, so one
    // more item is read and `before` itself dropped here).
    const r = await doc.send(new QueryCommand({ TableName: TABLE, ScanIndexForward: false, Limit: before ? n + 1 : n,
      ...(before ? { KeyConditionExpression: 'pk = :p AND sk BETWEEN :m AND :b', ExpressionAttributeValues: { ':p': `THREAD#${thread}`, ':b': `MSG#${before}`, ':m': 'MSG#' } }
        : { KeyConditionExpression: 'pk = :p AND begins_with(sk, :m)', ExpressionAttributeValues: { ':p': `THREAD#${thread}`, ':m': 'MSG#' } }) }));
    return (r.Items ?? []).filter(i => i.sk !== `MSG#${before}`).slice(0, n).reverse().map(({ pk, sk, ...m }) => m as Message);
  },
  // Search. One space with at most SEARCH_QUERY_MAX_THREADS threads (⌘K scoped to a space, or a person who sees only
  // one): Query its thread index rows, then each thread's MSG# rows, SEARCH_QUERY_CONCURRENCY at a time. Otherwise one
  // parallel Scan of the whole table (message rows + thread index rows; the router filters by membership). Measured
  // Nov 2026 in the warm hub Lambda (table 9 MB, 11.8k messages): Scan 400-490 ms / 1104 read units; Query 6-70 ms and
  // 1-4 units on spaces of 1-6 threads, but 1.7-2.7 s / 407 units on 722 threads (~3 ms a thread), hence the cap: a
  // bigger space keeps the Scan (its index read is ~1 call, wasted). The Query path is CPU-bound, not network-bound: on
  // 722 threads it burns 1.0-1.8 s of CPU (~1.5 ms per call: signing, TLS, parsing), ~58 % of its wall time, i.e. the
  // whole vCPU share of 1024 MB; even a full vCPU (1769 MB) would stay above the Scan. Both paths log `search_read`
  // (ms, cpu ms, read units).
  async searchCorpus(spaces) {
    const t0 = Date.now(), cpu0 = process.cpuUsage();
    let threads: SearchThread[] = [], messages: SearchMessage[] = [], units = 0, calls = 0, path = 'scan';
    const count = (r: { ConsumedCapacity?: { CapacityUnits?: number } }) => { units += r.ConsumedCapacity?.CapacityUnits ?? 0; calls++; };
    if (spaces.length === 1) {
      let start: Record<string, any> | undefined;
      do {
        const r = await doc.send(new QueryCommand({ TableName: TABLE, KeyConditionExpression: 'pk = :p AND begins_with(sk, :t)', ExclusiveStartKey: start,
          ProjectionExpression: 'id, #sp, title, #k, updatedAt', ExpressionAttributeNames: { '#sp': 'space', '#k': 'kind' },
          ExpressionAttributeValues: { ':p': `SPACE#${spaces[0]}`, ':t': 'THREAD#' }, ReturnConsumedCapacity: 'TOTAL' }));
        count(r); threads.push(...(r.Items ?? []) as SearchThread[]);
        start = r.LastEvaluatedKey;
      } while (start);
      if (threads.length <= SEARCH_QUERY_MAX_THREADS) {
        path = 'query';
        let next = 0;
        await Promise.all(Array.from({ length: Math.min(SEARCH_QUERY_CONCURRENCY, threads.length) }, async () => {
          while (next < threads.length) {
            const thread = threads[next++].id;
            let start: Record<string, any> | undefined;
            do {
              const r = await doc.send(new QueryCommand({ TableName: TABLE, KeyConditionExpression: 'pk = :p AND begins_with(sk, :m)', ExclusiveStartKey: start,
                ProjectionExpression: 'id, #th, author, #ty, #tx, files, #at', ExpressionAttributeNames: { '#th': 'thread', '#ty': 'type', '#tx': 'text', '#at': 'at' },
                ExpressionAttributeValues: { ':p': `THREAD#${thread}`, ':m': 'MSG#' }, ReturnConsumedCapacity: 'TOTAL' }));
              count(r); messages.push(...(r.Items ?? []) as SearchMessage[]);
              start = r.LastEvaluatedKey;
            } while (start);
          }
        }));
      } else threads = [];
    }
    if (path === 'scan') {
      await Promise.all(Array.from({ length: SEARCH_SEGMENTS }, async (_, segment) => {
        let start: Record<string, any> | undefined;
        do {
          const r = await doc.send(new ScanCommand({ TableName: TABLE, Segment: segment, TotalSegments: SEARCH_SEGMENTS, ExclusiveStartKey: start,
            FilterExpression: 'begins_with(sk, :m) OR (begins_with(pk, :s) AND begins_with(sk, :t))',
            ProjectionExpression: 'pk, sk, id, #th, author, #ty, #tx, files, #at, #sp, title, #k, updatedAt',
            ExpressionAttributeNames: { '#th': 'thread', '#ty': 'type', '#tx': 'text', '#at': 'at', '#sp': 'space', '#k': 'kind' },
            ExpressionAttributeValues: { ':m': 'MSG#', ':s': 'SPACE#', ':t': 'THREAD#' }, ReturnConsumedCapacity: 'TOTAL' }));
          count(r);
          for (const { pk, sk, ...i } of r.Items ?? []) {
            if (String(sk).startsWith('MSG#')) { if (String(pk).startsWith('THREAD#')) messages.push(i as SearchMessage); }
            else threads.push(i as SearchThread);
          }
          start = r.LastEvaluatedKey;
        } while (start);
      }));
    }
    console.log('search_read', JSON.stringify({ path, spaces: spaces.length, threads: threads.length,
      messages: messages.length, calls, units, ms: Date.now() - t0, cpu: Math.round((({ user, system }) => (user + system) / 1000)(process.cpuUsage(cpu0))) }));
    return { threads, messages };
  },
};

export async function putConnection(connId: string, who: Principal) {
  await doc.send(new PutCommand({ TableName: TABLE, Item: { pk: `CONN#${connId}`, sk: 'META', principalKind: who.kind, principalId: who.id, ttl: ttl() } }));
}
export async function getConnection(connId: string): Promise<Principal | null> {
  const i = await get(`CONN#${connId}`, 'META');
  return i?.principalKind ? { kind: i.principalKind, id: i.principalId } : null;
}
/** Drops the connection and its subscriptions; returns who it was and the spaces it was subscribed to (their presence
 *  changed), with the last input of a subscription that was away (`idle`, for the last seen). */
export async function dropConnection(connId: string): Promise<{ who: Principal | null; left: { space: string; idle?: number }[] }> {
  const i = await get(`CONN#${connId}`, 'META'), left: { space: string; idle?: number }[] = [];
  for (const s of (i?.spaces as Set<string> | undefined) ?? []) {
    const old = (await doc.send(new DeleteCommand({ TableName: TABLE, Key: { pk: `SUB#${s}`, sk: `CONN#${connId}` }, ReturnValues: 'ALL_OLD' }))).Attributes;
    left.push({ space: s, ...(old?.away === true && typeof old.idle === 'number' ? { idle: old.idle } : {}) });
  }
  if (i?.principalKind === 'instance') await doc.send(new DeleteCommand({ TableName: TABLE, Key: { pk: `INSTANCE#${i.principalId}`, sk: `CONN#${connId}` } }));
  await doc.send(new DeleteCommand({ TableName: TABLE, Key: { pk: `CONN#${connId}`, sk: 'META' } }));
  return { who: i?.principalKind ? { kind: i.principalKind, id: i.principalId } as Principal : null, left };
}

export const makeSender = (domain: string, stage: string) => makeSenderFromEndpoint(`https://${domain}/${stage}`);
export function makeSenderFromEndpoint(endpoint: string): Sender {
  const api = new ApiGatewayManagementApiClient({ endpoint });
  return {
    async send(connId, frame: HubFrame) {
      const data = JSON.stringify(frame);
      try { await retryThrottled(() => api.send(new PostToConnectionCommand({ ConnectionId: connId, Data: data })), `${frameKind(frame)} ${connId}`); return true; }
      catch (e) { if (e instanceof GoneException || (e as any)?.name === 'GoneException') return false; throw e; }
    },
    async close(connId) {
      try { await api.send(new DeleteConnectionCommand({ ConnectionId: connId })); }
      catch (e) { if (!(e instanceof GoneException || (e as any)?.name === 'GoneException')) throw e; }
    },
  };
}

const sqs = new SQSClient({});
const ssm = new SSMClient({});
/** Schedules a summary 60 s after the end of the turn (groups close turns together, see summarize.ts). */
export async function queueSummary(thread: string, at: number) {
  if (!process.env.SUMMARY_QUEUE_URL) return;
  await sqs.send(new SendMessageCommand({ QueueUrl: process.env.SUMMARY_QUEUE_URL, MessageBody: JSON.stringify({ thread, at }), DelaySeconds: 60 }));
}

/** Spaces with a linked GitHub Project (index kept by scripts/attach-github.ts, avoids a table scan). */
export async function githubSpaces(): Promise<string[]> { return [...((await get('INDEX', 'GITHUB'))?.spaces ?? [])] }

/**
 * Routine schedules (EventBridge Scheduler, group ROUTINE_GROUP): each one invokes the Routine Lambda with the role
 * ROUTINE_ROLE_ARN (lambda:InvokeFunction on it only), in Europe/Paris, no retry (a missed run is not replayed later in
 * the day), no flexible window. Without the variables (local, tests): undefined, routines are never scheduled.
 */
export function makeSchedules(): Schedules | undefined {
  const group = process.env.ROUTINE_GROUP, arn = process.env.ROUTINE_TARGET_ARN, role = process.env.ROUTINE_ROLE_ARN;
  if (!group || !arn || !role) return undefined;
  const client = new SchedulerClient({});
  return {
    async put(name, cron, enabled, input, opts) {
      const s: CreateScheduleCommandInput = { Name: name, GroupName: group, ScheduleExpression: cron, ScheduleExpressionTimezone: opts?.tz ?? ROUTINE_TZ,
        FlexibleTimeWindow: { Mode: 'OFF' }, State: enabled ? 'ENABLED' : 'DISABLED', ...(opts?.once ? { ActionAfterCompletion: 'DELETE' as const } : {}),
        Target: { Arn: arn, RoleArn: role, Input: input, RetryPolicy: { MaximumRetryAttempts: 0, MaximumEventAgeInSeconds: 60 } } };
      try { await client.send(new CreateScheduleCommand(s)); }
      catch (e: any) { if (e?.name !== 'ConflictException') throw e; await client.send(new UpdateScheduleCommand(s)); }
    },
    async remove(name) {
      try { await client.send(new DeleteScheduleCommand({ Name: name, GroupName: group })); }
      catch (e: any) { if (e?.name !== 'ResourceNotFoundException') throw e; }
    },
  };
}

/** Web Push job (thread became Your turn), sent by the Push Lambda, the only one that reads the VAPID private key. */
export async function queuePush(job: PushJob) {
  if (!process.env.PUSH_QUEUE_URL) return;
  await sqs.send(new SendMessageCommand({ QueueUrl: process.env.PUSH_QUEUE_URL, MessageBody: JSON.stringify(job) }));
}
/** VAPID public key (plain SSM String, not a secret: every browser gets it). Missing = Web Push off. Only a success is
 *  cached, for KEY_CACHE_MS: a rotated key (scripts/put-vapid-key.ts --rotate) reaches warm Lambdas within that delay. */
export const KEY_CACHE_MS = 10 * 60_000;
let pushPublic: { key: string; at: number } | null = null;
export async function pushKey(): Promise<string | null> {
  if (!process.env.PUSH_PUBLIC_PARAM) return null;
  if (pushPublic && Date.now() - pushPublic.at < KEY_CACHE_MS) return pushPublic.key;
  try { const key = (await ssm.send(new GetParameterCommand({ Name: process.env.PUSH_PUBLIC_PARAM }))).Parameter?.Value; pushPublic = key ? { key, at: Date.now() } : null }
  catch (e: any) { if (e?.name !== 'ParameterNotFound') throw e; pushPublic = null }
  return pushPublic?.key ?? null;
}

// ---------------------------------------------------------------- Agent preview TURN (protocol/preview.ts)
// One KVS signaling channel per stack, used ONLY for its managed TURN (our signaling goes through the hub). IAM:
// GetSignalingChannelEndpoint + GetIceServerConfig on that channel only (infra/app.ts). The HTTPS endpoint is cached for
// the Lambda's life; credentials are fetched per peer (5 minutes each). No channel = preview off.
const PREVIEW_CHANNEL_ARN = process.env.PREVIEW_CHANNEL_ARN;
let kvsSignaling: KinesisVideoSignalingClient | null = null;
async function previewIceImpl(peer: string): Promise<IceServer[]> {
  if (!kvsSignaling) {
    const ep = await new KinesisVideoClient({}).send(new GetSignalingChannelEndpointCommand({ ChannelARN: PREVIEW_CHANNEL_ARN,
      SingleMasterChannelEndpointConfiguration: { Protocols: ['HTTPS'], Role: 'VIEWER' } }));
    const url = ep.ResourceEndpointList?.find(e => e.Protocol === 'HTTPS')?.ResourceEndpoint;
    if (!url) throw new Error('kvs: no HTTPS endpoint');
    kvsSignaling = new KinesisVideoSignalingClient({ endpoint: url });
  }
  const r = await kvsSignaling.send(new GetIceServerConfigCommand({ ChannelARN: PREVIEW_CHANNEL_ARN, ClientId: peer, Service: 'TURN' }));
  const region = PREVIEW_CHANNEL_ARN!.split(':')[3];
  return [{ urls: [`stun:stun.kinesisvideo.${region}.amazonaws.com:443`] },
    ...(r.IceServerList ?? []).map(s => ({ urls: s.Uris ?? [], username: s.Username, credential: s.Password }))];
}
export const previewIce = PREVIEW_CHANNEL_ARN ? previewIceImpl : undefined;

/**
 * Temporary AWS elevation (elevation/CONTRACT.md): the elevation Lambda lives in the management account; its resource
 * policy lets only this function's role invoke it, and this role may invoke only it (infra/app.ts). The hub relays,
 * the Lambda checks the passkey: being able to call it grants nothing.
 */
const ELEVATION_FUNCTION_ARN = process.env.ELEVATION_FUNCTION_ARN;
let elevationLambda: LambdaClient | undefined;
async function elevationImpl(payload: Record<string, unknown>): Promise<any> {
  elevationLambda ??= new LambdaClient({ region: ELEVATION_FUNCTION_ARN!.split(':')[3] });
  const r = await elevationLambda.send(new InvokeCommand({ FunctionName: ELEVATION_FUNCTION_ARN, Payload: new TextEncoder().encode(JSON.stringify(payload)) }));
  if (r.FunctionError || !r.Payload) throw new Error(`elevation: ${r.FunctionError ?? 'no payload'}`);
  return JSON.parse(new TextDecoder().decode(r.Payload));
}
export const elevation = ELEVATION_FUNCTION_ARN ? elevationImpl : undefined;

export async function queueGithub(job: object) {
  if (!process.env.GITHUB_QUEUE_URL) return;
  await sqs.send(new SendMessageCommand({ QueueUrl: process.env.GITHUB_QUEUE_URL, MessageBody: JSON.stringify(job) }));
}

// ---------------------------------------------------------------- Cognito (invitations)
// IAM: AdminCreateUser (invitation and its resend), AdminGetUser and ListUsers on this pool only (infra/app.ts).
const POOL = process.env.USER_POOL_ID;
const idp = new CognitoIdentityProviderClient({});
const subOf = (attrs?: AttributeType[]) => attrs?.find(a => a.Name === 'sub')?.Value;
export const users: Users | undefined = POOL ? {
  async findByEmail(email) {
    // `email` matched EMAIL_RE (no quote nor backslash): it cannot break out of the filter string.
    const r = await idp.send(new ListUsersCommand({ UserPoolId: POOL, Filter: `email = "${email}"`, AttributesToGet: ['sub'], Limit: 10 }));
    return (r.Users ?? []).map(u => subOf(u.Attributes)).filter((s): s is string => !!s);
  },
  async pending() {
    const out = new Map<string, number>();
    let token: string | undefined;
    do { // small pool (a few dozen people): 60 per page
      const r = await idp.send(new ListUsersCommand({ UserPoolId: POOL, Filter: 'cognito:user_status = "FORCE_CHANGE_PASSWORD"', AttributesToGet: ['sub'], PaginationToken: token }));
      for (const u of r.Users ?? []) { const s = subOf(u.Attributes); if (s) out.set(s, (u.UserLastModifiedDate ?? u.UserCreateDate ?? new Date()).getTime()); }
      token = r.PaginationToken;
    } while (token);
    return out;
  },
  async invite(email) {
    try {
      // Cognito generates the temporary password and mails it with the pool's invitation template; it never goes through here.
      const r = await idp.send(new AdminCreateUserCommand({ UserPoolId: POOL, Username: email, DesiredDeliveryMediums: ['EMAIL'],
        UserAttributes: [{ Name: 'email', Value: email }, { Name: 'email_verified', Value: 'true' }] }));
      return { id: subOf(r.User?.Attributes)!, created: true };
    } catch (e: any) {
      if (e?.name !== 'UsernameExistsException') throw e; // created meanwhile (another tab): add it, no second mail
      return { id: subOf((await idp.send(new AdminGetUserCommand({ UserPoolId: POOL, Username: email }))).UserAttributes)!, created: false };
    }
  },
  async resend(id) {
    if (!/^[\w-]{1,64}$/.test(id)) return false; // goes into the filter string: no quote can break out of it
    const r = await idp.send(new ListUsersCommand({ UserPoolId: POOL, Filter: `sub = "${id}"`, Limit: 1 }));
    const u = r.Users?.[0];
    if (!u?.Username || u.UserStatus !== 'FORCE_CHANGE_PASSWORD') return false;
    try { // new temporary password generated and mailed by Cognito with the invitation template, never seen here
      await idp.send(new AdminCreateUserCommand({ UserPoolId: POOL, Username: u.Username, MessageAction: 'RESEND', DesiredDeliveryMediums: ['EMAIL'] }));
      return true;
    } catch (e: any) { if (e?.name === 'UnsupportedUserStateException' || e?.name === 'UserNotFoundException') return false; throw e; } // signed in meanwhile
  },
} : undefined;

// Invited agents' app clients. IAM: CreateUserPoolClient / DeleteUserPoolClient on this pool only (infra/app.ts).
// 24 h access tokens: M2M tokens are billed per request. A removed agent is still cut at once: its INSTANCE# record goes
// first (authorizer and router check it) and its sockets are closed (agents.ts cutInstance). Existing clients:
// scripts/agent-token-validity.ts.
export const AGENT_TOKEN_HOURS = 24;
const STACK = process.env.STACK_NAME ?? 'briefling';
export const agentClients: AgentClients | undefined = POOL && process.env.TOKEN_URL ? {
  async create(agent) {
    const r = await idp.send(new CreateUserPoolClientCommand({ UserPoolId: POOL, ClientName: `${STACK}-agent-${agent}`, GenerateSecret: true,
      AllowedOAuthFlowsUserPoolClient: true, AllowedOAuthFlows: ['client_credentials'], AllowedOAuthScopes: [process.env.INSTANCE_SCOPE ?? 'briefling/instance'],
      AccessTokenValidity: AGENT_TOKEN_HOURS, TokenValidityUnits: { AccessToken: 'hours' }, ExplicitAuthFlows: [], EnableTokenRevocation: true }));
    return { id: r.UserPoolClient!.ClientId!, secret: r.UserPoolClient!.ClientSecret!, tokenUrl: process.env.TOKEN_URL! };
  },
  async remove(id) {
    try { await idp.send(new DeleteUserPoolClientCommand({ UserPoolId: POOL, ClientId: id })); }
    catch (e: any) { if (e?.name !== 'ResourceNotFoundException') throw e; } // already gone: same outcome
  },
} : undefined;

// ---------------------------------------------------------------- S3 (attachments)
const s3 = new S3Client({});
const BUCKET = process.env.FILES_BUCKET;
export const files: Files | undefined = BUCKET ? {
  async presignPost(key, mime, size) {
    // The S3 policy enforces key, type and max size: the browser can send nothing else, nor anywhere else.
    const p = await createPresignedPost(s3, { Bucket: BUCKET, Key: key, Expires: 300,
      Conditions: [['content-length-range', 1, size], ['eq', '$Content-Type', mime]], Fields: { 'Content-Type': mime } });
    return { url: p.url, fields: p.fields };
  },
  async presignGet(key, f) {
    // Only raster images, audio and video are served inline; everything else (SVG, HTML, PDF…) is forced to download.
    const { type, disposition } = servedAs(f);
    return getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: key,
      ResponseContentType: type, ResponseContentDisposition: disposition }), { expiresIn: 600 });
  },
  async size(key) {
    try { return (await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }))).ContentLength ?? null; }
    catch (e: any) { if (e?.name === 'NotFound' || e?.$metadata?.httpStatusCode === 404) return null; throw e; }
  },
  async remove(key) { await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key })) }, // S3: no error when absent
  async putText(key, text) { await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: text, ContentType: 'text/plain; charset=utf-8' })) },
  async getText(key) {
    try { return await (await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }))).Body?.transformToString('utf-8') ?? null }
    catch (e) { if ((e as Error)?.name === 'NoSuchKey') return null; throw e }
  },
  async getBytes(key) {
    try { return await (await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }))).Body?.transformToByteArray() ?? null }
    catch (e) { if ((e as Error)?.name === 'NoSuchKey') return null; throw e }
  },
} : undefined;
// Site bucket (served by CloudFront): the pinned applets' manifests and icons only (hub/src/pinapp.ts). The role may
// write `a/*` and nothing else of the site; 5 min of cache so a rename reaches the installed app soon.
const SITE = process.env.SITE_BUCKET;
export const site: Site | undefined = SITE ? {
  async put(key, body, type) {
    if (!pinFileOk(key)) throw new Error('bad site key');
    await s3.send(new PutObjectCommand({ Bucket: SITE, Key: key, Body: body, ContentType: type, CacheControl: 'public, max-age=300' }));
  },
  async remove(key) { if (!pinFileOk(key)) throw new Error('bad site key'); await s3.send(new DeleteObjectCommand({ Bucket: SITE, Key: key })) },
} : undefined;
