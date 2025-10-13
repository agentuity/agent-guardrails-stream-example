import type { PiiItem } from './pii-detection';

export function redactPII(text: string, piiItems: PiiItem[]): string {
  if (!piiItems?.length) return text;

  let redactedText = text;
  for (const item of piiItems) {
    redactedText = redactedText.replaceAll(
      item.value,
      `[REDACTED:${item.type.toUpperCase()}]`
    );
  }

  return redactedText;
}
