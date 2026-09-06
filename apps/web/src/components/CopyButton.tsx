/**
 * CopyButton.tsx — copy a string (the SQL, a snippet, an API key) to the clipboard and confirm it.
 *
 * Why it exists: 03-UI's SQL panel and Projects snippets have a Copy control; this is the one place the
 * clipboard write and its "Copied" feedback live. It degrades quietly: where `navigator.clipboard` is
 * unavailable (an insecure origin, an old browser) the button reports it rather than throwing.
 */
import { useCallback, useState, type JSX } from 'react';
import { Icon } from './Icons.js';

export function CopyButton({ text, label = 'Copy', className = 'btn sm' }: { text: string; label?: string; className?: string }): JSX.Element {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const copy = useCallback(() => {
    const settle = (next: 'copied' | 'failed'): void => {
      setState(next);
      window.setTimeout(() => setState('idle'), 1_400);
    };
    const clipboard = navigator.clipboard as Clipboard | undefined;
    if (!clipboard) {
      settle('failed');
      return;
    }
    clipboard.writeText(text).then(() => settle('copied')).catch(() => settle('failed'));
  }, [text]);
  return (
    <button type="button" className={className} onClick={copy}>
      <Icon name="i-copy" />
      {state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : label}
    </button>
  );
}
