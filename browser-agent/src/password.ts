import { stdin, stdout } from 'node:process';
import { emitKeypressEvents, type Key } from 'node:readline';

// Raw console input: password never echoes or appears in shell arguments/history.
export function readPassword(): Promise<string> {
  if (!stdin.isTTY) throw new Error('INTERACTIVE_CONSOLE_REQUIRED');
  stdout.write('Mat khau website (an khi nhap): ');
  return new Promise((resolve, reject) => {
    const wasRaw = stdin.isRaw;
    let value = '';
    const done = () => { stdin.off('keypress', onKey); stdin.setRawMode(wasRaw); stdin.pause(); stdout.write('\n'); };
    const onKey = (text: string | undefined, key: Key) => {
      if (key.name === 'return' || key.name === 'enter') { done(); resolve(value); return; }
      if (key.ctrl && key.name === 'c') { done(); reject(new Error('CANCELLED')); return; }
      if (key.name === 'backspace') { value = Array.from(value).slice(0, -1).join(''); return; }
      if (!key.ctrl && !key.meta && text && !/[\u0000-\u001f\u007f]/.test(text) && value.length + text.length <= 200) value += text;
    };
    emitKeypressEvents(stdin);
    stdin.on('keypress', onKey); stdin.setRawMode(true); stdin.resume();
  });
}
