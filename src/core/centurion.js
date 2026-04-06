// ============================================================
// PLURIBUS — Centurion Loop v2
// PERCEIVE → PLAN → ACT → OBSERVE → REMEMBER → LOOP
// Now with: abort, file context, richer streaming events,
// better parse fallbacks for 1-bit models
// ============================================================

import { randomUUID } from 'crypto';
import { BrowserTool } from '../tools/browser.js';
import { CodeTool } from '../tools/code.js';

const MAX_ITERATIONS = 25;
const MAX_OBS_LEN = 6000;

const SYSTEM_PROMPT = `You are a Centurion — an autonomous AI agent in Pluribus.
You do not talk about acting. You ACT.

TOOLS:
- browser_navigate(url) — Open a URL, read the page
- browser_search(query) — Google search, get results
- browser_click(selector) — Click a page element
- browser_type(selector, text) — Type into a form field
- browser_screenshot() — Capture the current page
- browser_extract_text() — Get all visible page text
- browser_extract_links() — Get all links on page
- browser_set_cookies(cookies) — Load auth cookies for a site
- code_execute(language, code) — Run Python, JavaScript, or Bash
- file_write(filename, content) — Save a file
- file_read(filename) — Read a file
- file_list(dir) — List files in workspace
- complete(summary) — Mission accomplished
- abort(reason) — Cannot complete

RESPOND WITH EXACTLY ONE JSON BLOCK PER MESSAGE:
\`\`\`json
{"tool":"tool_name","args":{"key":"value"},"reasoning":"brief why"}
\`\`\`

CRITICAL RULES:
1. ONE action per response. No prose before or after the JSON block.
2. If an action failed, try a DIFFERENT approach. Never repeat failures.
3. Use browser_search for information. Use code_execute for computation.
4. Use file_write to save deliverables the user can download.
5. When done, use "complete" with a clear summary of what was accomplished.
6. Keep reasoning to one sentence. Act, don't explain.`;

export class CenturionLoop {
  constructor(llm, memory, emitEvent) {
    this.llm = llm;
    this.memory = memory;
    this.emit = emitEvent || (() => {});
    this.browser = new BrowserTool();
    this.code = new CodeTool();
    this.currentMission = null;
    this.abortRequested = false;
  }

  abort() {
    this.abortRequested = true;
  }

  async executeMission(objective, uploadedFiles = []) {
    const missionId = randomUUID().slice(0, 12);
    this.memory.createMission(missionId, objective);
    this.currentMission = missionId;
    this.abortRequested = false;

    const contextHistory = [];
    let totalIn = 0, totalOut = 0;
    let result = null;

    this.emit('mission.started', { missionId, objective });

    // Build memory context
    const episodes = this.memory.getRecentEpisodes(5);
    const failures = this.memory.getFailurePatterns(5);
    let memCtx = '';
    if (episodes.length > 0) {
      memCtx += '\n\nPAST MISSIONS:\n' + episodes.map(e => `- [${e.outcome}] ${e.summary}`).join('\n');
    }
    if (failures.length > 0) {
      memCtx += '\n\nKNOWN FAILURES (avoid):\n' + failures.map(f =>
        `${f.summary}${f.lessons.length ? ' → ' + f.lessons.join('; ') : ''}`
      ).join('\n');
    }

    // File context from uploads
    let fileCtx = '';
    if (uploadedFiles.length > 0) {
      fileCtx = '\n\nUPLOADED FILES (available in workspace):\n' +
        uploadedFiles.map(f => `- ${f.name} (${f.size} bytes) → workspace/${f.name}`).join('\n');
    }

    contextHistory.push({
      role: 'user',
      content: `MISSION: ${objective}\n\nPlan your approach, then take the first action.${fileCtx}${memCtx}`,
    });

    for (let i = 1; i <= MAX_ITERATIONS; i++) {
      // Check abort
      if (this.abortRequested) {
        result = { success: false, summary: 'Mission aborted by Commander.' };
        this.emit('mission.aborted', { missionId });
        break;
      }

      const t0 = Date.now();
      this.emit('mission.iteration', { missionId, iteration: i, total: MAX_ITERATIONS, phase: 'thinking' });

      // ── REASON ──
      let response;
      try {
        response = await this.llm.chat(SYSTEM_PROMPT, contextHistory, { maxTokens: 2048 });
      } catch (err) {
        this.emit('mission.error', { missionId, iteration: i, error: `LLM: ${err.message}` });
        // Give it one more chance
        contextHistory.push({ role: 'assistant', content: '{"tool":"code_execute","args":{"language":"bash","code":"echo error"},"reasoning":"recovering"}' });
        contextHistory.push({ role: 'user', content: 'OBSERVATION:\nLLM error occurred. Try a simpler action.' });
        continue;
      }

      totalIn += response.inputTokens;
      totalOut += response.outputTokens;
      const raw = response.text;

      // ── PARSE ──
      const action = this._parseAction(raw, i);

      this.emit('mission.iteration', {
        missionId, iteration: i, total: MAX_ITERATIONS,
        phase: 'acting', tool: action.tool, reasoning: action.reasoning,
      });

      // ── EXECUTE ──
      let observation;
      if (action.tool === 'complete') {
        result = { success: true, summary: action.args?.summary || action.reasoning || raw };
        observation = 'Mission complete.';
      } else if (action.tool === 'abort') {
        result = { success: false, summary: action.args?.reason || 'Agent aborted.' };
        observation = 'Mission aborted.';
      } else {
        try {
          observation = await this._exec(action);
        } catch (err) {
          observation = `ERROR: ${err.message}`;
        }
      }

      const obs = this._trunc(observation, MAX_OBS_LEN);
      const ms = Date.now() - t0;

      // ── LOG ──
      this.memory.logIteration(missionId, {
        iteration: i, actionType: action.tool,
        reasoning: action.reasoning || '', observation: obs,
        tokens: response.inputTokens + response.outputTokens, durationMs: ms,
      });

      this.emit('mission.action', {
        missionId, iteration: i, tool: action.tool,
        reasoning: action.reasoning, observation: obs, durationMs: ms,
      });

      // ── CONTEXT ──
      contextHistory.push({ role: 'assistant', content: raw });
      contextHistory.push({
        role: 'user',
        content: `OBSERVATION:\n${obs}\n\nNext action (or "complete" if done):`,
      });

      // Trim context window
      if (contextHistory.length > 20) {
        const first = contextHistory[0];
        const recent = contextHistory.slice(-14);
        contextHistory.length = 0;
        contextHistory.push(first, { role: 'user', content: '[Earlier iterations condensed.]' }, ...recent);
      }

      if (result) break;
    }

    // ── FINALIZE ──
    if (!result) {
      result = { success: false, summary: `Max iterations (${MAX_ITERATIONS}) reached.` };
    }

    // Collect any files created
    const files = this.code.listFiles('.');
    const createdFiles = files.success ? files.files.filter(f => f.type === 'file').map(f => f.name) : [];

    result.files = createdFiles;
    result.tokens = { input: totalIn, output: totalOut, total: totalIn + totalOut };

    this.memory.updateMission(missionId, {
      status: result.success ? 'completed' : 'failed',
      result: JSON.stringify(result),
      iterations: contextHistory.filter(m => m.role === 'assistant').length,
      input_tokens: totalIn, output_tokens: totalOut,
      completed_at: new Date().toISOString(),
    });

    this.memory.recordEpisode(
      missionId,
      `${objective} → ${result.summary}`,
      result.success ? 'success' : 'failure', []
    );

    this.emit('mission.completed', { missionId, result });
    await this.browser.close();
    this.currentMission = null;

    return result;
  }

  _parseAction(text, iteration) {
    // Strategy 1: find ```json block
    const fenced = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    if (fenced) {
      try {
        const p = JSON.parse(fenced[1]);
        if (p.tool) return p;
      } catch {}
    }

    // Strategy 2: find raw JSON object with "tool" key
    const raw = text.match(/\{\s*"tool"\s*:\s*"[^"]+"\s*[,}][\s\S]*?\}/);
    if (raw) {
      try {
        const p = JSON.parse(raw[0]);
        if (p.tool) return p;
      } catch {}
    }

    // Strategy 3: look for tool name patterns in prose
    const toolMatch = text.match(/(?:use|call|execute|run)\s+(\w+)\s*\(/i);
    if (toolMatch) {
      const tool = toolMatch[1];
      if (tool === 'browser_search') {
        const q = text.match(/search.*?["']([^"']+)["']/i) || text.match(/search.*?for\s+(.+?)[\.\n]/i);
        if (q) return { tool: 'browser_search', args: { query: q[1] }, reasoning: 'Extracted from prose' };
      }
    }

    // Strategy 4: if it sounds complete
    const lower = text.toLowerCase();
    if (lower.includes('mission complete') || lower.includes('task is done') ||
        lower.includes('here are the results') || lower.includes('i have completed')) {
      return { tool: 'complete', args: { summary: text }, reasoning: '' };
    }

    // Strategy 5: force a structured retry on next iteration
    if (iteration <= 2) {
      return {
        tool: 'code_execute',
        args: { language: 'bash', code: 'echo "Centurion ready. Awaiting structured command."' },
        reasoning: 'Parse failed — resetting. Will retry with structured output.',
      };
    }

    // After multiple parse failures, treat as completion
    return { tool: 'complete', args: { summary: text }, reasoning: 'Could not parse structured action.' };
  }

  async _exec(action) {
    const { tool, args } = action;
    if (!tool || !args) return 'ERROR: Invalid action';

    try {
      if (tool.startsWith('browser_')) return JSON.stringify(await this.browser.execute(tool, args));
      if (['code_execute', 'file_write', 'file_read', 'file_list'].includes(tool))
        return JSON.stringify(this.code.executeTool(tool, args));
      return `ERROR: Unknown tool "${tool}"`;
    } catch (err) {
      return `ERROR: ${err.message}`;
    }
  }

  _trunc(t, max) {
    if (typeof t !== 'string') t = JSON.stringify(t);
    return t.length <= max ? t : t.slice(0, max) + '\n...[truncated]';
  }

  isRunning() { return !!this.currentMission; }
  getMissionId() { return this.currentMission; }
}
