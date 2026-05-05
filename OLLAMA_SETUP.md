# Ollama Setup Guide

This project uses Ollama for free, local AI processing. No API keys needed.

## Installation

1. Download Ollama from https://ollama.ai
2. Install the application for your OS (macOS, Windows, or Linux)

## Setup

Run these commands in terminal:

```bash
# Pull your preferred model (one-time download)
ollama pull kimi-k2.5:cloud
# OR
ollama pull glm-5:cloud
# OR
ollama pull qwen3.5:cloud

# Start the Ollama server
ollama serve
```

The server runs on `http://localhost:11434` (this is the localhost URL for all models).

## Verify It Works

```bash
curl http://localhost:11434/api/generate -d '{"model":"llama2","prompt":"hello","stream":false}'
```

Should return a JSON response with a "response" field.

## Keep Running

- **macOS/Linux**: Run `ollama serve` in a terminal (keep it open while using the app)
- **Windows**: Ollama runs as a service automatically after installation

## Switch Models

Edit `.env.local` and change `OLLAMA_MODEL` to any of:
- `kimi-k2.5:cloud` (best all-around, recommended)
- `glm-5:cloud` (good for Chinese-friendly content)
- `qwen3.5:cloud` (strong reasoning)
- `llama2` (local, no cloud)

Then restart the app. Ollama runs them all through `http://localhost:11434`.

## What This Powers

- Lead summarization (pain points, attack angles, email messages)
- Reply classification (interest level detection)  
- Lead scoring (engagement potential)

All models run locally through Ollama. No additional API calls needed.
