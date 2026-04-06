# PLURIBUS

**E Pluribus Unum — Out of Many, One.**

A truly agentic AI platform. No API keys. No cloud. Runs locally on a 1-bit LLM that fits in 1.15 GB.

Pluribus doesn't talk about doing things. It does them.

```
Cancel my Amazon subscription for dog food.
Find me a 3-bedroom beach house in Destin under $400k.
Write a song based on my resume.
Monitor my Facebook Marketplace listing and counter lowball offers.
```

Every agent (a **Centurion**) has a real browser, a code interpreter, and file system access.
It plans, executes, recovers from failure, and delivers results — not summaries.

## Quick Start

```bash
git clone https://github.com/yourname/pluribus.git
cd pluribus
chmod +x start.sh
./start.sh
```

Open `http://localhost:3000`. Give your orders, Commander.

**Requirements:** Node.js 18+ and [Ollama](https://ollama.ai). That's it.
On first run, Pluribus pulls [PrismML Bonsai 8B](https://prismml.com) — a 1-bit model
that's 14x smaller, 8x faster, and 5x more energy efficient than standard LLMs.
No API keys. No accounts. No cloud. Just your machine.

## Why Bonsai?

| | Standard 8B Model | Bonsai 8B (1-bit) |
|---|---|---|
| Memory | 16 GB | 1.15 GB |
| Speed | Baseline | 8x faster |
| Energy | Baseline | 5x less |
| Cost | Baseline | Free (Apache 2.0) |
| Benchmark quality | Baseline | Competitive |

Bonsai makes local AI practical. A capable agent brain that downloads in under a minute
and runs on a laptop with no GPU.

## What Makes This Different

**ChatGPT and Claude can research. They can't act.**

They can find 5 competitors and write an analysis. But they can't log into your QuickBooks,
pull your revenue numbers, compare them against public data, generate a spreadsheet,
email it to your partner, and schedule a follow-up meeting.

Pluribus can. It has a browser. It has a code interpreter. It has a file system.
If a human can do it on a computer, a Centurion can do it.

## Architecture

```
┌──────────────────────────────────────┐
│          YOU (localhost:3000)         │
└──────────────┬───────────────────────┘
               │ WebSocket
┌──────────────▼───────────────────────┐
│          CENTURION LOOP              │
│  PERCEIVE → PLAN → ACT → OBSERVE    │
│          → REMEMBER → LOOP           │
├──────────────────────────────────────┤
│  Bonsai 1-bit │ Browser  │ Code     │
│  (1.15 GB)    │(Playwright│ Exec    │
│               │ Chromium) │ Py/JS/Sh│
├──────────────────────────────────────┤
│  Memory (SQLite) │ File System       │
└──────────────────────────────────────┘
```

## Configuration

Edit `.env` to switch providers:

```env
# Default — free, local, no API key
LLM_PROVIDER=bonsai
BONSAI_MODEL=bonsai:8b      # 1.15 GB
# BONSAI_MODEL=bonsai:4b    # 0.57 GB, faster
# BONSAI_MODEL=bonsai:1.7b  # 0.24 GB, mobile-class

# Or any Ollama model
# LLM_PROVIDER=ollama
# OLLAMA_MODEL=qwen3:8b

# Or cloud (requires API key, better reasoning)
# LLM_PROVIDER=anthropic
# ANTHROPIC_API_KEY=sk-ant-...
```

## Docker

```bash
docker-compose up
```

Runs Pluribus + Ollama together. Zero local setup.

## Hierarchy

Pluribus uses a Roman military structure:

| Rank | What | Purpose |
|------|------|---------|
| **Legion** | The platform | All agents, all projects |
| **Cohort** | Project group | Agents scoped to one purpose |
| **Praetor** | Orchestrator | Routes work between Centurions |
| **Centurion** | Individual agent | Autonomous, persistent, does the work |

v0.1 ships with one Centurion. Multi-agent coordination is coming.

## Roadmap

- [x] v0.1 — Desktop agent, browser + code + files, Bonsai default
- [ ] v0.2 — Multi-Centurion, Praetor coordination, Cohort structure
- [ ] v0.3 — iOS companion app, Apple Shortcuts bridge
- [ ] v0.4 — Training Centurion, compute optimization
- [ ] v1.0 — Full platform, infinite training, the future

## Philosophy

Every "agentic" platform today is a chatbot with extra steps. They describe what they would do.
They summarize. They suggest.

Pluribus acts.

When you say "cancel my dog food subscription," it opens Amazon in a real browser,
navigates to Subscribe & Save, finds the item, and clicks cancel.

No wrappers. No prompt chains. No $15-per-task token burns.
Real agents. Free. Local. Yours.

## License

MIT
