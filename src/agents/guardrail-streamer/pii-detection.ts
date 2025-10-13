import type { AgentContext } from '@agentuity/sdk';
import { groq } from '@ai-sdk/groq';
import { generateObject } from 'ai';
import { z } from 'zod';

const PiiItemSchema = z.object({
  type: z.enum(['email', 'phone', 'ssn', 'credit_card']),
  value: z.string(),
});

const PiiDetectionSchema = z.object({
  pii: z.array(PiiItemSchema),
});

export type PiiItem = z.infer<typeof PiiItemSchema>;
export type PiiDetection = z.infer<typeof PiiDetectionSchema>;

const GROQ_MODEL = groq('llama-3.1-8b-instant');

export async function detectPII(
  text: string,
  ctx: AgentContext
): Promise<PiiItem[]> {
  try {
    const result = await generateObject({
      model: GROQ_MODEL,
      schema: PiiDetectionSchema,
      system:
        'You are a fast PII detector. Analyze the provided text and identify any personally identifiable information including emails, phone numbers, SSNs, and credit card numbers. Return the exact PII values found in the text.',
      prompt: `Analyze this text for PII:\n\n${text}`,
      temperature: 0.0,
    });

    return result.object.pii;
  } catch (error) {
    ctx.logger.warn('Groq PII detection failed: %o', error);
    return [];
  }
}
