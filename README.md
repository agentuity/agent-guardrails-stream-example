<div align="center">
    <img src="https://raw.githubusercontent.com/agentuity/cli/refs/heads/main/.github/Agentuity.png" alt="Agentuity" width="100"/> <br/>
    <strong>Build Agents, Not Infrastructure</strong> <br/>
    <br/>
        <a target="_blank" href="https://app.agentuity.com/deploy" alt="Agentuity">
            <img src="https://app.agentuity.com/img/deploy.svg" /> 
        </a>
    <br />
</div>

# 🛡️ Streaming Guardrails Agent

An Agentuity demo agent showcasing the **LLM-as-Judge/Guardrail** pattern using dual streams for confidential information detection and redaction.

## 🎯 Use Case

This agent demonstrates an internal company assistant for **SoleStep** (a fictional shoe company) that helps employees while automatically detecting and redacting company secrets in real-time:

- Financial data (revenue, margins, costs)
- Unreleased product information (codenames, features, launch dates)
- R&D details (formulas, prototypes, materials)
- Internal contacts (employee emails, phone extensions)
- Strategic plans (market expansion, pricing, M&A)

## 🏗️ Architecture

### Dual Stream Pattern

The agent creates two simultaneous streams:

1. **Main Stream** - Sanitized content with confidential info redacted
2. **Guardrail-Audit Stream** - Real-time status log showing detection activity

### How It Works

```
User Prompt → Claude (Content) → Buffer Chunks → Groq (Detection) → Redaction → Output
                                        ↓                    ↓
                                  Audit Log          [REDACTED:TYPE]
```

1. Claude generates streaming responses
2. Chunks accumulate until threshold (~200 chars)
3. Groq analyzes buffer for confidential information
4. Confidential items are replaced with `[REDACTED:TYPE]` markers
5. Sanitized content flows to main stream
6. Audit stream logs detection activity

### Key Features

- **Chunk Buffering** - Smart accumulation with configurable thresholds
- **Boundary Protection** - 64-char overlap to catch split secrets
- **Fast Detection** - Groq's GPT-OSS 20B model with structured outputs
- **Precise Redaction** - String replacement with typed markers

## 📋 Prerequisites

- **Bun**: Version 1.2.4 or higher
- **Agentuity CLI**: Latest version

## 🚀 Getting Started

### Authentication

Before using Agentuity, you need to authenticate:

```bash
agentuity login
```

This command will open a browser window where you can log in to your Agentuity account.

### Import this agent in to your account

```bash
agentuity project import
```

### Development Mode

Run your project in development mode with:

```bash
agentuity dev
```

This will start your project and open a new browser window connecting your agent to Agentuity in DevMode, allowing you to test and debug your agent in real-time.

## 🌐 Deployment

When you're ready to deploy your agent to the Agentuity Cloud:

```bash
agentuity deploy
```

This command will bundle your agent and deploy it to the cloud, making it accessible via the Agentuity platform.

## 📖 Resources

### Documentation
- [Agentuity JavaScript SDK](https://agentuity.dev/SDKs/javascript)
- [Agent Streaming Guide](https://agentuity.dev/Guides/agent-streaming)
- [Stream Storage API](https://agentuity.dev/SDKs/javascript/api-reference#stream-storage)

