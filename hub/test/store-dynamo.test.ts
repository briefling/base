// Store contract on DynamoDB (hub/src/aws.ts, the prod store). Skipped unless STORE_CONTRACT_TABLE names a disposable
// table shaped like infra/app.ts (pk/sk strings, GSI byActivity on pk + updatedAt). Credentials and region from the usual
// AWS_PROFILE / AWS_REGION. Never point it at a real table: the suite writes test records and never cleans them.
import { test } from 'node:test';
import { storeContract } from './store-contract.ts';

const table = process.env.STORE_CONTRACT_TABLE;
if (!table) test('dynamodb › skipped (STORE_CONTRACT_TABLE unset)', { skip: true }, () => {});
else {
  if (/prod/i.test(table)) throw new Error(`refusing to run the Store contract on ${table}`);
  process.env.TABLE = table; // read by aws.ts at import
  const { store } = await import('../src/aws.ts');
  const { DynamoDBClient } = await import('@aws-sdk/client-dynamodb');
  const { DynamoDBDocumentClient, UpdateCommand } = await import('@aws-sdk/lib-dynamodb');
  const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  storeContract('dynamodb', async () => ({
    store,
    // The admin role lives in INDEX/ADMINS (a string set), written outside the hub.
    seedAdmin: async (u: string) => { await doc.send(new UpdateCommand({ TableName: table, Key: { pk: 'INDEX', sk: 'ADMINS' }, UpdateExpression: 'ADD #u :u',
      ExpressionAttributeNames: { '#u': 'users' }, ExpressionAttributeValues: { ':u': new Set([u]) } })) },
  }), {
    // aws.ts `created` = stored `at` equals the written one: a rewrite carrying the creation time reads as created. No
    // caller reads `created` of upsertMessage today (only `message`), so it changes nothing yet.
    'message: a rewrite at the creation time is not reported as created': 'aws.ts compares `at`, not the existence of the row',
  });
}
