import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CopyButton } from '../src/components/CopyButton.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CopyButton', () => {
  it('writes the text to the clipboard and confirms with "Copied"', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<CopyButton text="SELECT 1" />);
    await userEvent.click(screen.getByRole('button'));
    expect(writeText).toHaveBeenCalledWith('SELECT 1');
    await waitFor(() => expect(screen.getByRole('button')).toHaveTextContent('Copied'));
  });

  it('reports a failure rather than throwing when the clipboard is unavailable', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    render(<CopyButton text="SELECT 1" />);
    await userEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(screen.getByRole('button')).toHaveTextContent('Copy failed'));
  });
});
