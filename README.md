# Astrology AI Agent

An Express.js server with Socket.io WebSockets support built with TypeScript.

## Project Structure

```text
astrology-ai-agent/
├── src/
│   ├── app/                # Express & Server configuration, DI container
│   ├── modules/            # Domain modules (voice, conversation, agent, astrology, RAG, memory, birth-profile, user)
│   ├── infrastructure/     # Database, LLM, Speech, Embeddings, Cache, Observability
│   ├── shared/             # Shared errors, types, utils, constants
│   └── index.ts            # Main application entry point
├── tests/                  # Unit, integration, and E2E tests
├── scripts/                # Database seeding scripts
├── .env
├── package.json
└── tsconfig.json
```

## Getting Started

### Installation

```bash
npm install
```

### Running Development Server

```bash
npm run dev
```

### Type Check & Build

```bash
npm run type-check
npm run build
```
