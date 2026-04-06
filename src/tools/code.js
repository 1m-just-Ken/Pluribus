// ============================================================
// PLURIBUS — Code Execution Tool
// Real code execution. Not a sandbox. Not a toy.
// ============================================================

import { execSync } from 'child_process';
import { writeFileSync, readFileSync, mkdirSync, existsSync, readdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';

const WORKSPACE = join(process.cwd(), '.pluribus', 'workspace');

export class CodeTool {
  constructor() {
    mkdirSync(WORKSPACE, { recursive: true });
  }

  execute(language, code, timeout = 30000) {
    const id = randomUUID().slice(0, 8);
    const ext = { python: 'py', javascript: 'js', bash: 'sh' }[language] || 'txt';
    const filepath = join(WORKSPACE, `${id}.${ext}`);

    writeFileSync(filepath, code);

    const cmd = {
      python: `python3 ${filepath}`,
      javascript: `node ${filepath}`,
      bash: `bash ${filepath}`,
    }[language];

    if (!cmd) return { success: false, error: `Unsupported language: ${language}` };

    try {
      const output = execSync(cmd, {
        timeout,
        maxBuffer: 2 * 1024 * 1024,
        encoding: 'utf-8',
        cwd: WORKSPACE,
      });
      return { success: true, output: output.trim() || '(no output)' };
    } catch (err) {
      if (err.killed) {
        return { success: false, error: `Timed out after ${timeout / 1000}s` };
      }
      const stderr = err.stderr?.toString().trim() || '';
      const stdout = err.stdout?.toString().trim() || '';
      return { success: false, error: `Exit ${err.status}: ${stderr || stdout}` };
    } finally {
      try { unlinkSync(filepath); } catch {}
    }
  }

  // File operations the agent can use
  writeFile(filename, content) {
    const filepath = join(WORKSPACE, filename);
    mkdirSync(join(filepath, '..'), { recursive: true });
    writeFileSync(filepath, content);
    return { success: true, path: filepath };
  }

  readFile(filename) {
    const filepath = join(WORKSPACE, filename);
    if (!existsSync(filepath)) return { success: false, error: `File not found: ${filename}` };
    const content = readFileSync(filepath, 'utf-8');
    return { success: true, content };
  }

  listFiles(dir = '.') {
    const fullPath = join(WORKSPACE, dir);
    if (!existsSync(fullPath)) return { success: false, error: `Directory not found: ${dir}` };
    const files = readdirSync(fullPath, { withFileTypes: true })
      .map(f => ({ name: f.name, type: f.isDirectory() ? 'dir' : 'file' }));
    return { success: true, files };
  }

  getToolDescriptions() {
    return [
      { name: 'code_execute', description: 'Write and execute code (python, javascript, or bash)', params: ['language', 'code'] },
      { name: 'file_write', description: 'Write content to a file in the workspace', params: ['filename', 'content'] },
      { name: 'file_read', description: 'Read a file from the workspace', params: ['filename'] },
      { name: 'file_list', description: 'List files in the workspace', params: ['dir'] },
    ];
  }

  executeTool(toolName, args) {
    switch (toolName) {
      case 'code_execute': return this.execute(args.language, args.code);
      case 'file_write': return this.writeFile(args.filename, args.content);
      case 'file_read': return this.readFile(args.filename);
      case 'file_list': return this.listFiles(args.dir || '.');
      default: return { success: false, error: `Unknown tool: ${toolName}` };
    }
  }
}
