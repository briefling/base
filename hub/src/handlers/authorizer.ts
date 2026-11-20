// $connect authorizer: checks the Cognito token passed in Sec-WebSocket-Protocol
// (a browser cannot set an Authorization header on a WebSocket, and the URL would end up in the logs).
// Expected header shapes: "briefling.v2, <access token>", to redeem an agent invitation "briefling.v2, join.<code>",
// or for a visitor link (protocol/preview.ts « Visitor link ») "briefling.v2, visitor.<msg>.<secret>".
import { createHash, timingSafeEqual } from 'node:crypto';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import type { APIGatewayRequestAuthorizerEvent } from 'aws-lambda';
import { PROTOCOL, AGENT_CODE_RE } from '../../../protocol/frames.ts';
import { VISITOR_PREFIX, visitorToken } from '../../../protocol/preview.ts';

const WEB = process.env.WEB_CLIENT_ID!;
const INSTANCES = process.env.INSTANCE_CLIENT_IDS!.split(','); // static instances (infra/app.ts)
const INSTANCE_SCOPE = process.env.INSTANCE_SCOPE!;
const TABLE = process.env.TABLE!;
// Any client of this pool: invited agents' clients are created by the hub at run time. Instances are then held to the
// instance scope and to their INSTANCE# record (deleted when the agent is removed, while its last token still verifies).
const verifier = CognitoJwtVerifier.create({ userPoolId: process.env.USER_POOL_ID!, tokenUse: 'access', clientId: null });
const db = new DynamoDBClient({});
const exists = async (pk: string, sk: string) =>
  !!(await db.send(new GetItemCommand({ TableName: TABLE, Key: { pk: { S: pk }, sk: { S: sk } }, ProjectionExpression: 'pk' }))).Item;

const policy = (effect: 'Allow' | 'Deny', resource: string, context?: Record<string, string>) => ({
  principalId: context?.principalId ?? 'anonymous',
  policyDocument: { Version: '2012-10-17', Statement: [{ Action: 'execute-api:Invoke', Effect: effect, Resource: resource }] },
  ...(context ? { context } : {}),
});

export const handler = async (event: APIGatewayRequestAuthorizerEvent) => {
  const header = event.headers?.['Sec-WebSocket-Protocol'] ?? event.headers?.['sec-websocket-protocol'] ?? '';
  const parts = header.split(',').map(s => s.trim());
  if (parts.length !== 2 || parts[0] !== PROTOCOL) return policy('Deny', event.methodArn);
  try {
    if (parts[1].startsWith('join.')) {
      // Invitation code: only its hash is stored. The connection may then only send agent.join (router).
      const code = parts[1].slice(5);
      if (!AGENT_CODE_RE.test(code)) return policy('Deny', event.methodArn);
      const hash = createHash('sha256').update(code).digest('hex');
      if (!await exists('AGENTINVITE', hash)) return policy('Deny', event.methodArn);
      return policy('Allow', event.methodArn, { principalId: hash, kind: 'join' });
    }
    if (parts[1].startsWith(VISITOR_PREFIX)) {
      // Visitor link: the line's record holds sha256(secret) and the deadline. The connection may then only signal that
      // line's preview (router), each frame checked again against the record.
      const t = visitorToken(parts[1].slice(VISITOR_PREFIX.length));
      if (!t) return policy('Deny', event.methodArn);
      const i = (await db.send(new GetItemCommand({ TableName: TABLE, Key: { pk: { S: `VISITOR#${t.msg}` }, sk: { S: 'META' } }, ProjectionExpression: '#h, #u',
        ExpressionAttributeNames: { '#h': 'hash', '#u': 'until' } }))).Item;
      const want = Buffer.from(i?.hash?.S ?? '', 'hex'), got = createHash('sha256').update(t.secret).digest();
      if (want.length !== got.length || !timingSafeEqual(want, got) || !(Number(i?.until?.N) > Date.now())) return policy('Deny', event.methodArn);
      console.log('visitor_connect', JSON.stringify({ msg: t.msg, ip: event.requestContext?.identity?.sourceIp ?? null }));
      // The hash rides in the principal: a replaced link's socket, even one still open, no longer matches the record.
      return policy('Allow', event.methodArn, { principalId: `${t.msg}:${i!.hash!.S}`, kind: 'visitor' });
    }
    const p = await verifier.verify(parts[1]);
    if (p.client_id === WEB) return policy('Allow', event.methodArn, { principalId: p.sub, kind: 'human' });
    const scopes = String(p.scope ?? '').split(' ');
    if (!scopes.includes(INSTANCE_SCOPE)) return policy('Deny', event.methodArn);
    if (!INSTANCES.includes(p.client_id as string) && !await exists(`INSTANCE#${p.client_id}`, 'META')) return policy('Deny', event.methodArn);
    return policy('Allow', event.methodArn, { principalId: p.client_id as string, kind: 'instance' });
  } catch {
    return policy('Deny', event.methodArn);
  }
};
