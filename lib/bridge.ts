// TCP client for emu/bridge.lua (one command per line, one reply per line).
// Commands are serialized; a dropped socket reconnects on the next command.
// PRESS is never retried automatically: callers verify a move by reading RAM,
// so every press happens at most once.
import net from "node:net";

type Pending = { resolve: (line: string) => void; reject: (err: Error) => void };

export class Bridge {
  private sock: net.Socket | null = null;
  private buf = "";
  private pending: Pending[] = [];
  private chain: Promise<unknown> = Promise.resolve();
  constructor(readonly port: number, readonly host = "127.0.0.1") {}

  private connect(): Promise<net.Socket> {
    if (this.sock && !this.sock.destroyed) return Promise.resolve(this.sock);
    return new Promise((resolve, reject) => {
      const s = net.createConnection({ port: this.port, host: this.host });
      s.setNoDelay(true);
      s.setEncoding("utf8");
      s.once("connect", () => { this.sock = s; resolve(s); });
      s.once("error", (err) => { this.fail(err); reject(err); });
      s.on("data", (chunk: string) => {
        this.buf += chunk;
        let i: number;
        while ((i = this.buf.indexOf("\n")) >= 0) {
          const line = this.buf.slice(0, i).replace(/\r$/, "");
          this.buf = this.buf.slice(i + 1);
          this.pending.shift()?.resolve(line);
        }
      });
      s.on("close", () => this.fail(new Error("bridge socket closed")));
    });
  }

  private fail(err: Error) {
    this.sock = null;
    this.buf = "";
    for (const p of this.pending.splice(0)) p.reject(err);
  }

  /** Send one command and wait for its reply line. */
  cmd(line: string, timeoutMs = 5000): Promise<string> {
    const run = async () => {
      const s = await this.connect();
      return await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => { s.destroy(); reject(new Error(`bridge timeout: ${line.split(" ")[0]}`)); }, timeoutMs);
        this.pending.push({
          resolve: (l) => { clearTimeout(timer); resolve(l); },
          reject: (e) => { clearTimeout(timer); reject(e); },
        });
        s.write(line + "\n");
      });
    };
    const p = this.chain.then(run, run);
    this.chain = p.catch(() => undefined);
    return p;
  }

  /** Like cmd, but retries a read-only command once after a reconnect. */
  async read(line: string): Promise<string> {
    try { return await this.cmd(line); } catch { return await this.cmd(line); }
  }

  close() { this.sock?.destroy(); this.sock = null; }
}

const shared = new Map<number, Bridge>();
export function bridge(port: number): Bridge {
  let b = shared.get(port);
  if (!b) { b = new Bridge(port); shared.set(port, b); }
  return b;
}
