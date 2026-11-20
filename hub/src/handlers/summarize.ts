import type { SQSEvent } from 'aws-lambda';
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { store, makeSenderFromEndpoint } from '../aws.ts';
import { summarize } from '../summarize.ts';

const br = new BedrockRuntimeClient({});
const MODEL = process.env.SUMMARY_MODEL!;
const sender = makeSenderFromEndpoint(process.env.WS_ENDPOINT!);

const llm = async (system: string, user: string) => {
  const r = await br.send(new ConverseCommand({
    modelId: MODEL, system: [{ text: system }], messages: [{ role: 'user', content: [{ text: user }] }],
    inferenceConfig: { maxTokens: 600, temperature: 0.2 },
  }));
  return (r.output?.message?.content ?? []).map(c => c.text ?? '').join('');
};

export const handler = async (event: SQSEvent) => {
  for (const rec of event.Records) {
    const { thread, at } = JSON.parse(rec.body);
    try {
      console.log('summary', thread, await summarize({ store, sender, llm }, thread, at));
    } catch (e) {
      // No retry: the next turn will trigger a summary again. Never any thread content in the logs.
      console.error('summary_failed', thread, (e as Error)?.name, (e as Error)?.message?.slice(0, 200));
    }
  }
};
