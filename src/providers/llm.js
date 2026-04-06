// ============================================================
// PLURIBUS — LLM Provider
// Default: PrismML Bonsai 1-bit (1.15GB, Apache 2.0)
// Fallback: Ollama with any model
// Optional: Anthropic, OpenAI, DeepSeek
// ============================================================

import { Ollama } from 'ollama';

// Bonsai models — 1-bit, tiny, fast, Apache 2.0
const BONSAI_MODELS = {
  'bonsai:8b':  { size: '1.15 GB', params: '8B',   description: 'Flagship — best reasoning' },
  'bonsai:4b':  { size: '0.57 GB', params: '4B',   description: 'Fast — desktop/laptop' },
  'bonsai:1.7b':{ size: '0.24 GB', params: '1.7B', description: 'Ultra-light — mobile/edge' },
};

const DEFAULT_MODEL = 'bonsai:8b';

export class LLMProvider {
  constructor() {
    this.provider = process.env.LLM_PROVIDER || 'ollama';
    this.model = null;
    this.client = null;
    this.isBonsai = false;
  }

  async init() {
    switch (this.provider) {
      case 'bonsai':
      case 'ollama': {
        const host = process.env.OLLAMA_HOST || 'http://localhost:11434';
        this.client = new Ollama({ host });

        // If provider is explicitly 'bonsai' or no model specified, use Bonsai
        if (this.provider === 'bonsai' || !process.env.OLLAMA_MODEL) {
          this.model = process.env.BONSAI_MODEL || DEFAULT_MODEL;
          this.isBonsai = true;
        } else {
          this.model = process.env.OLLAMA_MODEL;
        }

        // Normalize provider to ollama for API calls
        this.provider = 'ollama';
        break;
      }
      case 'anthropic': {
        const { default: Anthropic } = await import('@anthropic-ai/sdk');
        this.client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
        this.model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514';
        break;
      }
      case 'openai': {
        const { default: OpenAI } = await import('openai');
        this.client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        this.model = process.env.OPENAI_MODEL || 'gpt-4o';
        break;
      }
      case 'deepseek': {
        const { default: OpenAI } = await import('openai');
        this.client = new OpenAI({
          apiKey: process.env.DEEPSEEK_API_KEY,
          baseURL: 'https://api.deepseek.com',
        });
        this.model = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
        break;
      }
      default:
        throw new Error(`Unknown provider: ${this.provider}. Options: bonsai, ollama, anthropic, openai, deepseek`);
    }
    return this;
  }

  async chat(systemPrompt, messages, options = {}) {
    switch (this.provider) {
      case 'ollama': return this._ollama(systemPrompt, messages, options);
      case 'anthropic': return this._anthropic(systemPrompt, messages, options);
      case 'openai':
      case 'deepseek': return this._openai(systemPrompt, messages, options);
    }
  }

  async _ollama(sys, msgs, opts) {
    const r = await this.client.chat({
      model: this.model,
      messages: [{ role: 'system', content: sys }, ...msgs],
      options: {
        temperature: opts.temperature || 0.3,
        num_predict: opts.maxTokens || 4096,
      },
      stream: false,
    });
    return {
      text: r.message.content,
      inputTokens: r.prompt_eval_count || 0,
      outputTokens: r.eval_count || 0,
    };
  }

  async _anthropic(sys, msgs, opts) {
    const r = await this.client.messages.create({
      model: this.model,
      max_tokens: opts.maxTokens || 4096,
      system: sys,
      messages: msgs.map(m => ({ role: m.role, content: m.content })),
    });
    return {
      text: r.content.filter(b => b.type === 'text').map(b => b.text).join('\n'),
      inputTokens: r.usage?.input_tokens || 0,
      outputTokens: r.usage?.output_tokens || 0,
    };
  }

  async _openai(sys, msgs, opts) {
    const r = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: opts.maxTokens || 4096,
      messages: [{ role: 'system', content: sys }, ...msgs.map(m => ({ role: m.role, content: m.content }))],
    });
    return {
      text: r.choices[0]?.message?.content || '',
      inputTokens: r.usage?.prompt_tokens || 0,
      outputTokens: r.usage?.completion_tokens || 0,
    };
  }

  async ensureModel() {
    if (this.provider !== 'ollama') return;

    try {
      const list = await this.client.list();
      const base = this.model.split(':')[0];
      const found = list.models?.some(m => m.name.startsWith(base));

      if (!found) {
        const bonsaiInfo = BONSAI_MODELS[this.model];
        if (bonsaiInfo) {
          console.log(`  Pulling ${this.model} (${bonsaiInfo.size}, 1-bit)...`);
          console.log(`  This is a one-time download. ${bonsaiInfo.description}.`);
        } else {
          console.log(`  Pulling ${this.model}...`);
        }
        await this.client.pull({ model: this.model, stream: false });
      }
    } catch (err) {
      throw new Error(`Ollama not reachable: ${err.message}`);
    }
  }

  getInfo() {
    const info = { provider: this.isBonsai ? 'bonsai' : this.provider, model: this.model };
    const bonsaiInfo = BONSAI_MODELS[this.model];
    if (bonsaiInfo) {
      info.size = bonsaiInfo.size;
      info.precision = '1-bit';
      info.license = 'Apache 2.0';
    }
    return info;
  }

  static listBonsaiModels() {
    return BONSAI_MODELS;
  }
}
