import type { AgentContext, AgentRequest, AgentResponse } from '@agentuity/sdk';
import { anthropic } from '@ai-sdk/anthropic';
import { streamText } from 'ai';
import { detectConfidential } from './confidential-detection';
import { redactConfidential } from './redaction';

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
    const userPrompt = await req.data.text();

    // Create two streams: main (sanitized output) and guardrail-audit (status log)
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
          await auditStream.write('Starting confidentiality guardrail...\n');

          // Stream response from Claude
          const aiStream = await streamText({
            model: CLAUDE_MODEL,
            system: 'You are an internal company assistant for SoleStep, a shoe company. You help employees with questions and tasks. When providing information, you may include realistic company data such as financial figures, product codenames, R&D details, employee contacts, and strategic plans for demonstration purposes.',
            messages: [{ role: 'user', content: userPrompt }],
            temperature: 0.4,
          });

          let pendingBuffer = '';
          let carryTail = '';

          // Validate then flush accumulated chunks
          const validateAndFlush = async (buffer: string) => {
            const textToCheck = carryTail + buffer;
            await auditStream.write(`Checking ${textToCheck.length} chars...\n`);

            // Check / detect confidential information
            const confItems = await detectConfidential(textToCheck, ctx);

            // Redact any confidential info found
            let sanitized = textToCheck;
            if (confItems.length > 0) {
              sanitized = redactConfidential(textToCheck, confItems);
              await auditStream.write(
                `Found ${confItems.length} confidential item(s): ${confItems.map((c) => c.type).join(', ')}\n`
              );
            } else {
              await auditStream.write('No confidential info found.\n');
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

              // Flush when buffer reaches threshold (keeps this demo simple)
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
					await mainStream.close();
          await auditStream.close()
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
      'Welcome to the SoleStep Internal Assistant! I help employees with company information while protecting confidential data using streaming guardrails.',
    prompts: [
      {
        data: 'Draft an internal memo summarizing our Q3 performance: revenue was $127M with 52% gross margin, unit costs reduced by 7%. Also mention that Project Zephyr launches in October.',
        contentType: 'text/plain',
      },
      {
        data: 'Write a product brief for our new shoe: Project Zephyr uses the AeroWeave upper material and FlexAir+ midsole. The R&D team developed a new foam compound: EVA 60%, TPU 28%, aerogel 12%.',
        contentType: 'text/plain',
      },
      {
        data: 'Share the contact info for our Growth team: Sarah Chen (sarah.chen@solestep.internal, ext 4521) and the strategic plan to enter EU markets in Q1 with a €129 price point.',
        contentType: 'text/plain',
      },
      {
        data: 'Explain how product development cycles typically work in the footwear industry.',
        contentType: 'text/plain',
      },
    ],
  };
};
