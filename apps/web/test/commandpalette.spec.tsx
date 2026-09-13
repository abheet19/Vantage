import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommandPalette } from '../src/components/CommandPalette.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CommandPalette', () => {
  it('is hidden when closed', () => {
    const { container } = render(<CommandPalette open={false} onClose={() => undefined} navigate={() => undefined} toast={() => undefined} />);
    expect(container.querySelector('.cmdk-scrim')).toHaveAttribute('hidden');
  });

  it('lists every screen plus the two actions when open, and focuses the search box', async () => {
    render(<CommandPalette open onClose={() => undefined} navigate={() => undefined} toast={() => undefined} />);
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveFocus());
    const list = screen.getByRole('listbox', { name: 'Screens and actions' });
    expect(within(list).getByText('Ask')).toBeInTheDocument();
    expect(within(list).getByText('Health')).toBeInTheDocument();
    expect(within(list).getByText('Copy link to this screen')).toBeInTheDocument();
    expect(within(list).getByText('Open Vantage on GitHub')).toBeInTheDocument();
  });

  it('filters as you type and shows an empty state for no match', async () => {
    render(<CommandPalette open onClose={() => undefined} navigate={() => undefined} toast={() => undefined} />);
    const input = screen.getByRole('combobox');
    await userEvent.type(input, 'retent');
    expect(screen.getByText('Retention')).toBeInTheDocument();
    expect(screen.queryByText('Funnel')).not.toBeInTheDocument();

    await userEvent.clear(input);
    await userEvent.type(input, 'zzzzz-no-such-thing');
    expect(screen.getByText('No matches')).toBeInTheDocument();
  });

  it('Enter navigates to the highlighted route and closes', async () => {
    const navigate = vi.fn();
    const onClose = vi.fn();
    render(<CommandPalette open onClose={onClose} navigate={navigate} toast={() => undefined} />);
    const input = screen.getByRole('combobox');
    await userEvent.type(input, 'retention');
    await userEvent.keyboard('{Enter}');
    expect(navigate).toHaveBeenCalledWith('retention');
    expect(onClose).toHaveBeenCalled();
  });

  it('ArrowDown moves the highlight before Enter commits it', async () => {
    const navigate = vi.fn();
    render(<CommandPalette open onClose={() => undefined} navigate={navigate} toast={() => undefined} />);
    const input = screen.getByRole('combobox');
    // With no filter the first item is "Ask"; one ArrowDown should land on "Funnel".
    await userEvent.keyboard('{ArrowDown}');
    await userEvent.keyboard('{Enter}');
    expect(navigate).toHaveBeenCalledWith('funnel');
    void input;
  });

  it('Escape closes without navigating', async () => {
    const onClose = vi.fn();
    const navigate = vi.fn();
    render(<CommandPalette open onClose={onClose} navigate={navigate} toast={() => undefined} />);
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('clicking the backdrop closes the palette', async () => {
    const onClose = vi.fn();
    const { container } = render(<CommandPalette open onClose={onClose} navigate={() => undefined} toast={() => undefined} />);
    const scrim = container.querySelector('.cmdk-scrim');
    if (!(scrim instanceof HTMLElement)) throw new Error('scrim not found');
    await userEvent.click(scrim);
    expect(onClose).toHaveBeenCalled();
  });

  it('clicking a route option navigates and closes', async () => {
    const navigate = vi.fn();
    const onClose = vi.fn();
    render(<CommandPalette open onClose={onClose} navigate={navigate} toast={() => undefined} />);
    await userEvent.click(screen.getByText('Events'));
    expect(navigate).toHaveBeenCalledWith('events');
    expect(onClose).toHaveBeenCalled();
  });

  it('copies the current link and toasts confirmation when the clipboard is available', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const toast = vi.fn();
    const onClose = vi.fn();
    render(<CommandPalette open onClose={onClose} navigate={() => undefined} toast={toast} />);
    await userEvent.click(screen.getByText('Copy link to this screen'));
    expect(writeText).toHaveBeenCalledWith(window.location.href);
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Link copied'));
    expect(onClose).toHaveBeenCalled();
  });

  it('reports a clipboard failure rather than throwing', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('nope'));
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const toast = vi.fn();
    render(<CommandPalette open onClose={() => undefined} navigate={() => undefined} toast={toast} />);
    await userEvent.click(screen.getByText('Copy link to this screen'));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Could not copy the link'));
  });

  it('toasts when there is no clipboard to copy to', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    const toast = vi.fn();
    render(<CommandPalette open onClose={() => undefined} navigate={() => undefined} toast={toast} />);
    await userEvent.click(screen.getByText('Copy link to this screen'));
    expect(toast).toHaveBeenCalledWith('Clipboard is unavailable here');
  });

  it('opens the GitHub link in a new tab and closes', async () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
    const onClose = vi.fn();
    render(<CommandPalette open onClose={onClose} navigate={() => undefined} toast={() => undefined} />);
    await userEvent.click(screen.getByText('Open Vantage on GitHub'));
    expect(openSpy).toHaveBeenCalledWith('https://github.com/abheet19/Vantage', '_blank', 'noopener,noreferrer');
    expect(onClose).toHaveBeenCalled();
  });
});
