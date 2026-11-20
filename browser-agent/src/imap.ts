import { connect as tlsConnect } from 'node:tls';

// Minimal IMAP client (just enough to read recent INBOX messages over XOAUTH2).
// No dependency: the agent ships with locked deps, and a tiny reader is easier to vet
// than a full IMAP library. Only used on Node (the Windows agent), never on the edge.

export interface ImapSocket {
  write(data: string): void;
  on(event: 'data', cb: (chunk: Buffer) => void): void;
  on(event: 'error', cb: (err: Error) => void): void;
  on(event: 'close', cb: () => void): void;
  end(): void;
}
export type Connector = (host: string, port: number) => Promise<ImapSocket>;

const tlsConnector: Connector = (host, port) => new Promise((resolve, reject) => {
  const socket = tlsConnect({ host, port, servername: host }, () => resolve(socket as unknown as ImapSocket));
  socket.once('error', reject);
  socket.setTimeout(30000, () => socket.destroy(new Error('IMAP_TIMEOUT')));
});

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

/** Reads IMAP responses, honouring `{N}` literals, and resolves each command at its tagged line. */
class Reader {
  private buffer = Buffer.alloc(0);
  private literal = 0;
  private waiters: Array<{ tag: string; lines: string[]; resolve: (lines: string[]) => void; reject: (e: Error) => void }> = [];
  feed(chunk: Buffer) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      if (this.literal > 0) {
        if (this.buffer.length < this.literal) return;
        this.push(this.buffer.subarray(0, this.literal).toString('binary'));
        this.buffer = this.buffer.subarray(this.literal); this.literal = 0;
      }
      const nl = this.buffer.indexOf('\n');
      if (nl < 0) return;
      const line = this.buffer.subarray(0, nl + 1).toString('binary');
      this.buffer = this.buffer.subarray(nl + 1);
      this.push(line);
      const lit = line.match(/\{(\d+)\}\r?\n$/);
      if (lit) this.literal = Number(lit[1]);
      else this.complete(line);
    }
  }
  private push(text: string) { const w = this.waiters[0]; if (w) w.lines.push(text); }
  private complete(line: string) {
    const w = this.waiters[0];
    if (!w) return;
    // Drop the trailing CRLF first: `.` doesn't cross `\r`, so an anchored match would miss.
    const m = line.replace(/\r?\n$/, '').match(/^(\S+) (OK|NO|BAD)\b(.*)$/);
    if (m && m[1] === w.tag) { this.waiters.shift(); m[2] === 'OK' ? w.resolve(w.lines) : w.reject(new Error(`IMAP_${m[2]}:${m[3].trim().slice(0, 120)}`)); }
    else if (/^\+/.test(line) && w.tag === 'AUTH') { this.waiters.shift(); w.reject(new Error('IMAP_AUTH_REJECTED')); }
  }
  expect(tag: string) { return new Promise<string[]>((resolve, reject) => this.waiters.push({ tag, lines: [], resolve, reject })); }
  fail(err: Error) { for (const w of this.waiters.splice(0)) w.reject(err); }
}

export interface RawMail { headers: string; body: string }

export async function readRecentMail(email: string, accessToken: string, count = 8, connector: Connector = tlsConnector): Promise<RawMail[]> {
  const socket = await connector('outlook.office365.com', 993);
  const reader = new Reader();
  let tag = 0;
  const next = () => `a${++tag}`;
  socket.on('data', c => reader.feed(c));
  socket.on('error', e => reader.fail(e));
  socket.on('close', () => reader.fail(new Error('IMAP_CLOSED')));
  const send = (t: string, line: string) => { const p = reader.expect(t); socket.write(`${t} ${line}\r\n`); return p; };
  try {
    await reader.expect('*');                               // server greeting (untagged OK)
    // AUTHENTICATE XOAUTH2 (one line, initial response inline).
    const auth = reader.expect('AUTH');
    socket.write(`AUTH AUTHENTICATE XOAUTH2 ${b64(`user=${email}\x01auth=Bearer ${accessToken}\x01\x01`)}\r\n`);
    await auth.catch(e => { throw new Error(e.message.includes('AUTH_REJECTED') ? 'MAIL_AUTH_REJECTED' : e.message); });
    const sel = await send(next(), 'SELECT INBOX');
    const exists = Number(sel.map(l => l.match(/^\* (\d+) EXISTS/)?.[1]).find(Boolean) ?? 0);
    if (!exists) return [];
    const from = Math.max(1, exists - count + 1);
    const lines = await send(next(), `FETCH ${from}:${exists} BODY.PEEK[]`);
    return parseFetch(lines);
  } finally { try { socket.end(); } catch { /* ignore */ } }
}

/** Split a FETCH response (literals already inlined) into raw messages. */
function parseFetch(lines: string[]): RawMail[] {
  const text = lines.join('');
  const mails: RawMail[] = [];
  const re = /\* \d+ FETCH \([^{]*\{(\d+)\}\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const start = m.index + m[0].length;
    const raw = text.slice(start, start + Number(m[1]));
    const split = raw.indexOf('\r\n\r\n');
    mails.push(split < 0 ? { headers: raw, body: '' } : { headers: raw.slice(0, split), body: raw.slice(split + 4) });
  }
  return mails;
}

// ── Minimal MIME decode: raw message -> { from, subject, date, text } for code extraction.
import type { Mail } from './mailcode.js';

function unfold(headers: string) {
  const map: Record<string, string> = {};
  for (const line of headers.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i > 0) map[line.slice(0, i).trim().toLowerCase()] ??= line.slice(i + 1).trim();
  }
  return map;
}
const decodeQP = (s: string) => s.replace(/=\r?\n/g, '').replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
const toText = (buf: string, cte: string, charset: string) => {
  const bytes = /base64/i.test(cte) ? Buffer.from(buf.replace(/\s+/g, ''), 'base64') : Buffer.from(/quoted-printable/i.test(cte) ? decodeQP(buf) : buf, 'binary');
  try { return new TextDecoder(/utf-?8/i.test(charset) ? 'utf-8' : charset || 'utf-8').decode(bytes); } catch { return bytes.toString('utf8'); }
};
/** Decode RFC 2047 encoded-words in a header value. */
function decodeHeader(value = '') {
  return value.replace(/=\?([^?]+)\?([bБBqQ])\?([^?]*)\?=/gi, (_, cs, enc, data) =>
    toText(/b/i.test(enc) ? data : data.replace(/_/g, ' '), /b/i.test(enc) ? 'base64' : 'quoted-printable', cs)).trim();
}

export function toMail(raw: RawMail): Mail {
  const h = unfold(raw.headers);
  const ctype = h['content-type'] ?? 'text/plain';
  const charsetOf = (ct: string) => ct.match(/charset="?([^";]+)"?/i)?.[1] ?? 'utf-8';
  let text = '';
  const boundary = ctype.match(/boundary="?([^";]+)"?/i)?.[1];
  if (/multipart/i.test(ctype) && boundary) {
    const parts = raw.body.split('--' + boundary).slice(1, -1).map(p => {
      const s = p.indexOf('\r\n\r\n'); return s < 0 ? null : { head: unfold(p.slice(0, s)), body: p.slice(s + 4) };
    }).filter(Boolean) as Array<{ head: Record<string, string>; body: string }>;
    const pick = parts.find(p => /text\/plain/i.test(p.head['content-type'] ?? '')) ?? parts.find(p => /text\/html/i.test(p.head['content-type'] ?? '')) ?? parts[0];
    if (pick) text = toText(pick.body, pick.head['content-transfer-encoding'] ?? '', charsetOf(pick.head['content-type'] ?? ''));
  } else {
    text = toText(raw.body, h['content-transfer-encoding'] ?? '', charsetOf(ctype));
  }
  return { from: decodeHeader(h['from']), subject: decodeHeader(h['subject']), date: h['date'], text };
}
