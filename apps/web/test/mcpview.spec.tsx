import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MCP_TOOLS } from '@vantage/contracts';
import { McpView } from '../src/views/McpView.js';

describe('McpView', () => {
  it('shows the claude_desktop_config.json block and the Claude Code one-liner', () => {
    render(<McpView />);
    expect(screen.getByTestId('mcp-config').textContent).toContain('"mcpServers"');
    expect(screen.getByTestId('mcp-config').textContent).toContain('"vantage"');
    expect(screen.getByTestId('mcp-command').textContent).toContain('claude mcp add vantage');
  });

  it('lists all eight tools, each with a readOnlyHint badge, from the contract', () => {
    render(<McpView />);
    const tools = within(screen.getByTestId('mcp-tools'));
    for (const t of MCP_TOOLS) expect(tools.getByText(t.name)).toBeInTheDocument();
    expect(tools.getAllByText('readOnlyHint')).toHaveLength(MCP_TOOLS.length);
  });

  it('labels the transcript as an example, not a live call', () => {
    render(<McpView />);
    expect(screen.getByText(/example — not a live call/)).toBeInTheDocument();
    expect(screen.getByTestId('mcp-transcript').textContent).toContain('run_funnel');
    expect(screen.getByText(/Illustrative\./)).toBeInTheDocument();
  });
});
