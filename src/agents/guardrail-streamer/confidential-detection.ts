import type { AgentContext } from '@agentuity/sdk';
import { groq } from '@ai-sdk/groq';
import { generateObject } from 'ai';
import { z } from 'zod';

const ConfidentialItemSchema = z.object({
  type: z.enum(['financial', 'product', 'rnd', 'contact', 'strategy']),
  value: z.string(),
});

const ConfidentialDetectionSchema = z.object({
  items: z.array(ConfidentialItemSchema),
});

export type ConfidentialItem = z.infer<typeof ConfidentialItemSchema>;

// Use Groq for speeeeeeed
const GROQ_MODEL = groq('openai/gpt-oss-20b');

export async function detectConfidential(
  text: string,
  ctx: AgentContext
): Promise<ConfidentialItem[]> {
  // Skip detection on empty/whitespace-only text
  if (!text || !text.trim()) return [];

  try {
    const result = await generateObject({
      model: GROQ_MODEL,
      schema: ConfidentialDetectionSchema,
      system:
        'You are a fast confidential information detector. Extract confidential company information in these categories: financial (revenue, costs, margins), product (unreleased names/features), rnd (formulas, prototypes), contact (internal emails/phones), strategy (plans, pricing, M&A). Return exact spans verbatim with the correct type. If none, return empty list.',
      prompt: `Analyze this text for confidential items:\n\n${text}`,
      temperature: 0.0,
    });

    return result.object.items;
  } catch (error) {
    ctx.logger.warn('Groq confidential detection failed: %o', error);
    return [];
  }
}
