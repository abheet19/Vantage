import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SqlView } from '../src/components/Sql.js';

const SQL = "SELECT count(*) FROM events\nWHERE project_id = $1 AND event = $2";

describe('SqlView', () => {
  it('shows the exact SQL text (token spans do not change the text content)', () => {
    render(<SqlView sql={SQL} params={['proj-1', 'signup']} />);
    const pre = screen.getByTestId('sql-text');
    expect(pre.textContent).toBe(SQL);
  });

  it('lists the bound parameters as $n = value, strings quoted', () => {
    render(<SqlView sql={SQL} params={['proj-1', 'signup']} />);
    const params = screen.getByTestId('sql-params');
    expect(params.textContent).toContain("$1 = 'proj-1'");
    expect(params.textContent).toContain("$2 = 'signup'");
  });

  it('renders no params block when there are none', () => {
    render(<SqlView sql="SELECT 1" params={[]} />);
    expect(screen.queryByTestId('sql-params')).toBeNull();
  });

  it('labels each parameter type: strings quoted, null/number/boolean/undefined as themselves', () => {
    render(<SqlView sql="SELECT 1" params={[null, 42, true, undefined]} />);
    const params = screen.getByTestId('sql-params').textContent ?? '';
    expect(params).toContain('$1 = null');
    expect(params).toContain('$2 = 42');
    expect(params).toContain('$3 = true');
    expect(params).toContain('$4 = undefined');
  });

  it('renders a diff when diffAgainst is given', () => {
    const before = "SELECT 1\ninterval '14 days'";
    const after = "SELECT 1\ninterval '7 days'";
    const { container } = render(<SqlView sql={after} params={[]} diffAgainst={before} />);
    expect(container.querySelector('.add')).not.toBeNull();
    expect(container.querySelector('.del')).not.toBeNull();
    expect(screen.getByTestId('sql-text').textContent).toContain("7 days");
  });
});
