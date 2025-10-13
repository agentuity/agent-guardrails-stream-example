import type { AgentContext, AgentRequest, AgentResponse } from '@agentuity/sdk';
import { anthropic } from '@ai-sdk/anthropic';
import { streamText } from 'ai';
import { detectPII } from './pii-detection';
import { redactPII } from './redaction';

const CLAUDE_MODEL = anthropic('claude-3-5-haiku-latest');
const CHAR_THRESHOLD = 200;
// Overlap window to catch PII that splits across chunk boundaries
const CARRY_TAIL_LENGTH = 64;

export default async function GuardrailStreamer(
  req: AgentRequest,
  resp: AgentResponse,
  ctx: AgentContext
) {
  try {
    // Get user prompt from request
    const userPrompt = (await req.data.text()) || 'Tell me about data privacy.';

    // Create two streams: main (sanitized output) and guardrail-audit (status log)
    const mainStream = await ctx.stream.create('main', {
      contentType: 'text/plain',
      metadata: { type: 'sanitized-content' },
    });

    const auditStream = await ctx.stream.create('guardrail-audit', {
      contentType: 'text/plain',
      metadata: { type: 'audit-log' },
    });

    // Process stream in background
    ctx.waitUntil(
      (async () => {
        try {
          await auditStream.write('Starting PII guardrail...\n');

          // Stream response from Claude
          const aiStream = await streamText({
            model: CLAUDE_MODEL,
            system: 'You are a helpful assistant. When asked for examples or demonstrations, you may use fictional sample data including example email addresses, phone numbers, and other contact information for educational purposes.',
            messages: [{ role: 'user', content: userPrompt }],
            temperature: 0.4,
          });

          let pendingBuffer = '';
          let carryTail = '';

          // Validate and flush accumulated chunks
          const validateAndFlush = async (buffer: string) => {
            // Prepend carry tail to handle PII split across boundaries
            const textToCheck = carryTail + buffer;
            await auditStream.write(`Checking ${textToCheck.length} chars...\n`);

            // Call Groq to detect PII
            const piiItems = await detectPII(textToCheck, ctx);

            // Redact any PII found
            let sanitized = textToCheck;
            if (piiItems.length > 0) {
              sanitized = redactPII(textToCheck, piiItems);
              await auditStream.write(
                `Found ${piiItems.length} PII item(s): ${piiItems.map((p) => p.type).join(', ')}\n`
              );
            } else {
              await auditStream.write('No PII found.\n');
            }

            // Only emit new content (skip overlap used for detection)
            const toEmit = sanitized.slice(carryTail.length);
            if (toEmit) {
              await mainStream.write(toEmit);
              await auditStream.write(`Emitted ${toEmit.length} chars.\n`);
            }
            
            // Keep last N chars for next boundary check
            carryTail = sanitized.slice(-CARRY_TAIL_LENGTH);
          };

          // Accumulate chunks and validate at thresholds
          for await (const event of aiStream.fullStream) {
            if (event.type === 'text-delta') {
              pendingBuffer += event.text;

              // Flush when buffer reaches threshold (keeps demo simple)
              if (pendingBuffer.length >= CHAR_THRESHOLD) {
                await validateAndFlush(pendingBuffer);
                pendingBuffer = '';
              }
            }

            if (event.type === 'finish') {
              break;
            }
          }

          // Flush any remaining buffer
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
        data: 'Create a fictional customer service scenario where someone provides their contact info: name, email address, phone number, and asks about their order.',
        contentType: 'text/plain',
      },
      {
        data: 'Write a sample customer profile with fictional contact details including email, phone, and credit card number for a demo database.',
        contentType: 'text/plain',
      },
      {
        data: 'Explain what PII means and give 3 fictional examples of emails and phone numbers that would be considered PII.',
        contentType: 'text/plain',
      },
      {
        data: 'Explain how neural networks work.',
        contentType: 'text/plain',
      },
    ],
  };
};
