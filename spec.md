# Streaming Guardrails Agent Specification

## Overview

An Agentuity agent that demonstrates the **LLM-as-Judge/Guardrail** pattern using dual streams:
- **Main stream**: PII-sanitized content from Claude
- **Guardrail-audit stream**: Real-time status log showing PII detection and redaction activity

## Architecture

### Single Agent with Dual Streams

```
User Prompt → Claude (Anthropic) → Chunk Buffer → Groq PII Detection → Sanitized Output
                                         ↓                    ↓
                                   Guardrail Log      Redaction Applied
```

### Flow

1. User sends prompt to agent
2. Claude (`claude-3-5-haiku-latest`) generates streaming response
3. Agent accumulates chunks into buffer (~200 chars or sentence boundary)
4. When threshold reached:
   - Send buffer to Groq (`llama-3.1-8b-instant`) for PII detection
   - Groq returns structured JSON with PII spans (type, start, end)
   - Apply redaction: replace PII with `[REDACTED:TYPE]`
   - Write sanitized text to **main** stream
   - Write status update to **guardrail-audit** stream
5. Repeat until stream complete
6. Close both streams

### Carry Tail Technique

To handle PII split across chunk boundaries, keep last 32 chars of previous buffer and prepend to next buffer during validation.

## Technical Specifications

### Models

- **Content Generation**: `anthropic('claude-3-5-haiku-latest')`
- **PII Detection**: `groq('llama-3.1-8b-instant')`

### PII Types Detected

- `email`
- `phone`
- `ssn`
- `credit_card`

### Chunk Accumulation Strategy

Buffer text until either:
- **≥ 200 characters** accumulated, OR
- **Sentence boundary** detected (`/[.!?]\s/`) AND ≥ 80 characters accumulated

### Groq Detection Schema (Zod)

```typescript
const PiiItemSchema = z.object({
  type: z.enum(['email', 'phone', 'ssn', 'credit_card']),
  value: z.string()
});

const PiiDetectionSchema = z.object({
  pii: z.array(PiiItemSchema)
});
```

### Groq Prompt

**System:**
```
You are a fast PII detector. Analyze the provided text and identify any personally identifiable information including emails, phone numbers, SSNs, and credit card numbers. Return the exact PII values found in the text.
```

**User:**
```
Analyze this text for PII:

{buffered_text}
```

### Redaction Strategy

1. Sort PII spans by start index
2. Build output string, replacing spans with `[REDACTED:TYPE]`
3. Example: `"Email me at john@example.com"` → `"Email me at [REDACTED:EMAIL]"`

### Error Handling

- **Groq failure or invalid response**: Log warning, pass text through unredacted
- **Stream errors**: Log error, close both streams gracefully
- **Claude stream errors**: Log error, flush any pending buffer, close streams

## Implementation Steps

### 1. Setup Dependencies

```bash
pnpm add @ai-sdk/groq zod
```

### 2. File Structure

```
src/agents/guardrail-streamer/
├── index.ts           # Main agent handler
├── pii-detection.ts   # Groq integration + Zod schemas
└── redaction.ts       # Redaction utility function
```

### 3. Core Functions

#### `detectPII(text: string, ctx: AgentContext): Promise<PiiItem[]>`
- Calls Groq with `generateObject`
- Returns array of PII items (type + value)
- Handles errors gracefully

#### `redactPII(text: string, piiItems: PiiItem[]): string`
- Uses `replaceAll()` to replace PII values with redaction markers
- Returns sanitized text

#### Main Agent Handler
- Creates two streams: `main` and `guardrail-audit`
- Streams Claude response
- Accumulates chunks with carry tail
- Validates and redacts on threshold
- Writes to both streams
- Closes streams on completion

### 4. Welcome Prompts

Update to showcase PII detection:
- "Tell me about data privacy and include example contact information"
- "Write a story about someone sharing their email and phone number"

## Demo Output Example

### Main Stream (sanitized):
```
Once upon a time, there was a developer named [REDACTED:NAME] who lived at 
[REDACTED:ADDRESS]. One day, they decided to share their contact info: 
[REDACTED:EMAIL] and [REDACTED:PHONE]...
```

### Guardrail-Audit Stream (status log):
```
Starting PII guardrail...
Checking 234 chars...
Found 2 PII items: email, phone
Redacted email at position 45-62
Redacted phone at position 68-80
Checking 189 chars...
No PII found.
Final check 156 chars...
No PII found.
Stream complete.
```

## Testing

### Test Prompts

1. **Clean text**: "Explain how neural networks work"
   - Expected: No redactions

2. **Email only**: "My email is john.doe@example.com and I love coding"
   - Expected: `[REDACTED:EMAIL]`

3. **Multiple PII**: "Contact me: john@test.com or 555-123-4567. My SSN is 123-45-6789"
   - Expected: All three redacted

4. **Boundary test**: Craft prompt where email spans across 200-char boundary
   - Expected: Carry tail catches it

### Success Criteria

- Both streams created and accessible
- PII correctly detected and redacted
- Guardrail-audit stream shows real-time status
- No crashes on edge cases
- Clean error handling

## Future Enhancements (Out of Scope)

- Additional PII types (address, DOB, names)
- Configurable sensitivity levels
- Async validation for lower latency
- Token-aware boundaries instead of character-based
- Rate limiting for Groq calls
