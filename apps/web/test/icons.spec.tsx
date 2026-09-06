import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Icon, IconSprite } from '../src/components/Icons.js';

describe('Icons', () => {
  it('defines the symbols the app references', () => {
    const { container } = render(<IconSprite />);
    expect(container.querySelector('symbol#i-ask')).not.toBeNull();
    expect(container.querySelector('symbol#i-db')).not.toBeNull();
    expect(container.querySelector('symbol#i-rotate')).not.toBeNull();
  });

  it('references a symbol by name and is aria-hidden', () => {
    const { container } = render(<Icon name="i-play" />);
    const use = container.querySelector('use');
    expect(use?.getAttribute('href')).toBe('#i-play');
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });
});
