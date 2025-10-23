import { afterEach, describe, it } from 'node:test';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { Server } from '../index.ts';
import assume from 'assume';
import { create, destroy } from './create.ts';

describe('prompts: review', () => {
  let server: Server | null = null;
  let client: Client | null = null;

  afterEach(async () => {
    if (server && client) await destroy(server, client);
    server = null;
    client = null;
  });

  it('lists and renders the review prompt with instructions', async () => {
    ({ server, client } = await create({
      instructions: [{ name: 'review', content: 'Always mention {{ profile.name }} when reviewing {{ args.repository }}.' }]
    }));

    const list = await client.listPrompts();
    assume(list.prompts.map((prompt) => prompt.name)).includes('review');

    const result = await client.getPrompt({ name: 'review', arguments: { repository: 'oss-review', focus: 'security controls' } });
    const promptMessages = result.messages ?? [];
    assume(promptMessages).has.length(3);

    const persona = promptMessages[0];
    assume(persona.content).has.property('type', 'text');
    assume(persona.content?.text).includes('OSS Readiness Deep Reviewer');

    const guidance = promptMessages[1];
    assume(guidance.content).has.property('type', 'text');
    assume(guidance.content?.text).includes('Repository under review: oss-review.');
    assume(guidance.content?.text).includes('security controls');

    const instruction = promptMessages[2];
    assume(instruction.content).has.property('type', 'text');
    assume(instruction.content?.text).includes('GoDaddy');
    assume(instruction.content?.text).includes('oss-review');
  });

  it('provides sensible defaults and templating when optional arguments are omitted', async () => {
    ({ server, client } = await create());

    const result = await client.getPrompt({ name: 'review', arguments: { repository: 'oss-review' } });
    const promptMessages = result.messages ?? [];
    assume(promptMessages).has.length(2);

    const persona = promptMessages[0];
    assume(persona.content).has.property('type', 'text');
    assume(persona.content?.text).includes('OSS Readiness Deep Reviewer');

    const guidance = promptMessages[1];
    assume(guidance.content).has.property('type', 'text');
    assume(guidance.content?.text).includes('Repository under review: oss-review.');
    assume(guidance.content?.text).includes('general readiness');
  });
});

