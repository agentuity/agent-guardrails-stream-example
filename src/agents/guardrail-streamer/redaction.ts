import type { ConfidentialItem } from './confidential-detection';

const REDACTION_MARKERS: Record<ConfidentialItem['type'], string> = {
  financial: '[REDACTED:FINANCIAL]',
  product: '[REDACTED:PRODUCT]',
  rnd: '[REDACTED:RND]',
  contact: '[REDACTED:CONTACT]',
  strategy: '[REDACTED:STRATEGY]',
};

export function redactConfidential(
  text: string,
  items: ConfidentialItem[]
): string {
  if (!items?.length) return text;

  // Sort by length because of potential overlaps
  const sorted = [...items].sort((a, b) => b.value.length - a.value.length);

  let redactedText = text;
  for (const item of sorted) {
    if (!item.value) continue;
    
    // Escape regex special characters in the value
    const escaped = item.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    redactedText = redactedText.replace(
      new RegExp(escaped, 'g'),
      REDACTION_MARKERS[item.type]
    );
  }

  return redactedText;
}
