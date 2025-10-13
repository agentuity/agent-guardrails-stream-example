import type { AgentContext, AgentRequest, AgentResponse } from '@agentuity/sdk';
import { anthropic } from '@ai-sdk/anthropic';
import { streamText } from 'ai';
import { detectPII } from './pii-detection';
import { redactPII } from './redaction';

const CLAUDE_MODEL = anthropic('claude-3-5-haiku-latest');
const SENTENCE_END = /[.!?]\s/;
const CHAR_THRESHOLD = 200;
const MIN_SENTENCE_CHARS = 80;
const CARRY_TAIL_LENGTH = 32;

export default async function GuardrailStreamer(
  req: AgentRequest,
  resp: AgentResponse,
  ctx: AgentContext
) {
  try {
    const body = (await req.data.json().catch(() => ({}))) as { prompt?: string };
    const userPrompt: string =
      body?.prompt || (await req.data.text()) || 'Tell me about data privacy.';

    const mainStream = await ctx.stream.create('main', {
      contentType: 'text/plain',
      metadata: { type: 'sanitized-content' },
    });

    const auditStream = await ctx.stream.create('guardrail-audit', {
      contentType: 'text/plain',
      metadata: { type: 'audit-log' },
    });

    ctx.waitUntil(
      (async () => {
        try {
          await auditStream.write('Starting PII guardrail...\n');

          const aiStream = await streamText({
            model: CLAUDE_MODEL,
            messages: [{ role: 'user', content: userPrompt }],
            temperature: 0.4,
          });

          let pendingBuffer = '';
          let carryTail = '';

          const validateAndFlush = async (buffer: string) => {
            const textToCheck = carryTail + buffer;
            await auditStream.write(`Checking ${textToCheck.length} chars...\n`);

            const piiItems = await detectPII(textToCheck, ctx);

            let sanitized = textToCheck;
            if (piiItems.length > 0) {
              sanitized = redactPII(textToCheck, piiItems);
              await auditStream.write(
                `Found ${piiItems.length} PII item(s): ${piiItems.map((p) => p.type).join(', ')}\n`
              );
            } else {
              await auditStream.write('No PII found.\n');
            }

            await mainStream.write(sanitized);
            carryTail = sanitized.slice(-CARRY_TAIL_LENGTH);
          };

          for await (const event of aiStream.fullStream) {
            if (event.type === 'text-delta') {
              pendingBuffer += event.text;

              const sentenceBoundary = SENTENCE_END.exec(pendingBuffer);
              const shouldFlushBySize = pendingBuffer.length >= CHAR_THRESHOLD;
              const shouldFlushBySentence =
                sentenceBoundary && pendingBuffer.length >= MIN_SENTENCE_CHARS;

              if (shouldFlushBySize || shouldFlushBySentence) {
                await validateAndFlush(pendingBuffer);
                pendingBuffer = '';
              }
            }

            if (event.type === 'finish') {
              break;
            }
          }

          if (pendingBuffer.length > 0) {
            await auditStream.write(`Final check ${pendingBuffer.length} chars...\n`);
            await validateAndFlush(pendingBuffer);
          }

          await auditStream.write('Stream complete.\n');
          await mainStream.close();
          await auditStream.close();
        } catch (error) {
          ctx.logger.error('Streaming error: %o', error);
          await auditStream.write('Error occurred; closing streams.\n');
          try {
            await mainStream.close();
          } catch {}
          try {
            await auditStream.close();
          } catch {}
        }
      })()
    );

    return resp.stream(mainStream.getReader());
  } catch (error) {
    ctx.logger.error('Error running agent:', error);
    return resp.text('Sorry, there was an error processing your request.');
  }
}

export const welcome = () => {
  return {
    welcome:
      'Welcome to the Streaming Guardrails Agent! I demonstrate real-time PII detection and redaction using dual streams.',
    prompts: [
      {
        data: 'Tell me a story about someone sharing their email john.doe@example.com and phone 555-123-4567.',
        contentType: 'text/plain',
      },
      {
        data: 'Write about data privacy and include example contact information like emails and phone numbers.',
        contentType: 'text/plain',
      },
      {
        data: 'Explain how neural networks work.',
        contentType: 'text/plain',
      },
    ],
  };
};
