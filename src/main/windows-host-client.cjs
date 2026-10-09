const { spawn } = require('node:child_process');
const readline = require('node:readline');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

class WindowsHostClient {
  constructor(scriptPath = path.join(__dirname, 'windows-host.ps1')) {
    if (process.platform !== 'win32') throw new Error('DeskIsland Windows host is only available on Windows.');
    this.child = spawn('powershell.exe', [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath,
    ], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.pending = new Map();
    this.lines = readline.createInterface({ input: this.child.stdout });
    this.lines.on('line', (line) => this.#onLine(line));
    this.child.on('error', (error) => this.#failAll(error));
    this.child.on('exit', (code) => this.#failAll(new Error(`Windows host exited (${code ?? 'unknown'}).`)));
  }

  request(method, payload = {}) {
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Windows host request timed out: ${method}`));
      }, 6000);
      this.pending.set(id, { resolve, reject, timeout });
      this.child.stdin.write(`${JSON.stringify({ id, method, ...payload })}\n`, (error) => {
        if (error) this.#settle(id, error);
      });
    });
  }

  close() {
    this.lines.close();
    this.child.kill();
    this.#failAll(new Error('Windows host closed.'));
  }

  #onLine(line) {
    let response;
    try { response = JSON.parse(line); }
    catch { return this.#failAll(new Error('Windows host returned invalid JSON.')); }
    const pending = this.pending.get(response.id);
    if (!pending) return;
    if (!response.ok) return this.#settle(response.id, new Error(response.error || 'Windows host request failed.'));
    this.#settle(response.id, null, response.result);
  }

  #settle(id, error, value) {
    const pending = this.pending.get(id);
    if (!pending) return;
    clearTimeout(pending.timeout);
    this.pending.delete(id);
    if (error) pending.reject(error);
    else pending.resolve(value);
  }

  #failAll(error) {
    for (const [id] of this.pending) this.#settle(id, error);
  }
}

module.exports = { WindowsHostClient };
