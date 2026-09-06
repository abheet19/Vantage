/**
 * McpView.tsx — the MCP setup screen (03-UI S8), the one screen deferred from S5. Ported from the prototype.
 *
 * Why it exists: Vantage is usable from Claude with no Vantage key and no Vantage model — the MCP client's
 * own model does English → spec, and the eight read-only tools ARE the grammar it must fit (design §5). This
 * screen shows how to register the server (the claude_desktop_config.json block and the Claude Code one-liner,
 * built by src/lib/mcp.ts the way tools/mcp-install.mjs builds them), the eight tools with their readOnlyHint
 * badges (rendered from the MCP_TOOLS contract, so the list here cannot drift from the server's), and a short,
 * clearly-labelled ILLUSTRATIVE transcript of Claude calling list_events then run_funnel.
 *
 * What it must never do: claim the server is registered (only the CLI writes the config — the SPA cannot read
 * Claude Desktop's file), or present the transcript as a live tool call. The transcript is static example text,
 * labelled as such; the honest live path is the Claude Desktop demo, not this page.
 */
import type { JSX } from 'react';
import { MCP_TOOLS, MCP_TOOL_ANNOTATIONS } from '@vantage/contracts';
import { Chip } from '../components/Chip.js';
import { CopyButton } from '../components/CopyButton.js';
import { Icon } from '../components/Icons.js';
import { CONFIG_PATH, INSTALL_COMMAND, claudeCodeCommand, claudeDesktopConfig } from '../lib/mcp.js';

/** An illustrative exchange, NOT a live call: the numbers are example values, marked as such below the transcript. */
const EXAMPLE_LIST_EVENTS_ARGS = '{ "project": "<a project id from list_projects>" }';
const EXAMPLE_LIST_EVENTS_RESULT = '{ "events": [ { "event": "signup", "count": 4930 }, { "event": "create_project", "count": 3118 }, … ] }';
const EXAMPLE_RUN_FUNNEL_ARGS = `{
  "kind": "funnel",
  "project": "<the same project id>",
  "range": { "from": "2026-08-01", "to": "2026-08-31" },
  "steps": [ { "event": "signup" }, { "event": "create_project" }, { "event": "invite_teammate" } ],
  "window": { "value": 7, "unit": "days" }
}`;
const EXAMPLE_RUN_FUNNEL_RESULT = `{
  "steps": [ { "event": "signup", "persons": … }, … ],
  "sql": "WITH e AS ( … ) SELECT …",
  "meta": { "status": "complete", "elapsed_ms": … }
}`;

export function McpView(): JSX.Element {
  const config = claudeDesktopConfig();
  const command = claudeCodeCommand();

  return (
    <section className="screen" aria-labelledby="h-mcp">
      <div className="screen-head">
        <div>
          <h1 id="h-mcp">MCP</h1>
          <p>
            Claude Desktop or Claude Code is the model; Vantage is the read-only tool set. No Vantage API key, no Vantage LLM. Eight tools, all <code>readOnlyHint</code>.
          </p>
        </div>
      </div>

      <div className="cols" style={{ gridTemplateColumns: 'minmax(0,480px) minmax(0,1fr)' }}>
        <div className="stack">
          <div className="panel check" data-testid="mcp-check">
            <span className="ic">
              <Icon name="i-mcp" />
            </span>
            <div>
              <b>Register with one command</b>
              <div className="small faint">
                Run <code>{INSTALL_COMMAND}</code> in the repo; it writes the config below and prints the Claude Code line. Restart Claude Desktop and the eight tools appear.
              </div>
            </div>
          </div>

          <div className="panel">
            <div className="panel-h">
              <h2>Config it writes</h2>
              <Chip tone="faint">{CONFIG_PATH}</Chip>
            </div>
            <div className="panel-b">
              <div className="snippet">
                <CopyButton text={config} className="btn sm copy" />
                <pre data-testid="mcp-config">{config}</pre>
              </div>
              <p className="small faint" style={{ marginTop: 8 }}>
                Absolute <code>node</code> path on purpose — bare <code>npx</code> fails under Claude Desktop on Windows. <code>{INSTALL_COMMAND}</code> fills the two placeholders from your machine and <code>.env</code>; run it with <code>-- --dry-run</code> to preview without writing.
              </p>
            </div>
          </div>

          <div className="panel">
            <div className="panel-h">
              <h2>Claude Code</h2>
            </div>
            <div className="panel-b">
              <div className="snippet">
                <CopyButton text={command} className="btn sm copy" />
                <pre data-testid="mcp-command">{command}</pre>
              </div>
              <p className="small faint" style={{ marginTop: 8 }}>
                The <code>.env</code> is read by node, so no database password lands in your shell history.
              </p>
            </div>
          </div>

          <div className="panel">
            <div className="panel-h">
              <h2>Tools</h2>
              <Chip tone="faint">{MCP_TOOLS.length} · stdio</Chip>
            </div>
            <div className="tools" data-testid="mcp-tools">
              {MCP_TOOLS.map((tool) => (
                <div className="tool" key={tool.name}>
                  <code>{tool.name}</code>
                  <span className="badge" title={`readOnlyHint: ${String(MCP_TOOL_ANNOTATIONS.readOnlyHint)}, destructiveHint: ${String(MCP_TOOL_ANNOTATIONS.destructiveHint)}`}>
                    <Icon name="i-lock" style={{ width: 12, height: 12 }} />
                    readOnlyHint
                  </span>
                  <span className="d">{tool.description}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-h">
            <h2>Claude Desktop · transcript</h2>
            <Chip tone="warn">example — not a live call</Chip>
          </div>
          <div className="transcript" data-testid="mcp-transcript">
            <div className="msg user">
              <div className="av">A</div>
              <div>
                <div className="who">You</div>
                <div className="txt">Of the people who signed up in August, how many created a project within a week, and how many of those invited someone?</div>
              </div>
            </div>
            <div className="msg claude">
              <div className="av">C</div>
              <div>
                <div className="who">Claude</div>
                <div className="txt">
                  Checking which event names exist in the project first, then running the funnel.
                  <div className="toolcall">
                    <div className="th">
                      <Icon name="i-mcp" />
                      tool call · <code>list_events</code>
                    </div>
                    <pre>{EXAMPLE_LIST_EVENTS_ARGS}</pre>
                  </div>
                  <div className="toolcall result">
                    <div className="th">
                      <Icon name="i-check" />
                      result · <code>list_events</code>
                    </div>
                    <pre>{EXAMPLE_LIST_EVENTS_RESULT}</pre>
                  </div>
                </div>
              </div>
            </div>
            <div className="msg claude">
              <div className="av">C</div>
              <div>
                <div className="who">Claude</div>
                <div className="txt">
                  <div className="toolcall">
                    <div className="th">
                      <Icon name="i-mcp" />
                      tool call · <code>run_funnel</code>
                      <span className="badge" style={{ marginLeft: 'auto' }}>readOnlyHint</span>
                    </div>
                    <pre>{EXAMPLE_RUN_FUNNEL_ARGS}</pre>
                  </div>
                  <div className="toolcall result">
                    <div className="th">
                      <Icon name="i-check" />
                      result · <code>run_funnel</code>
                    </div>
                    <pre>{EXAMPLE_RUN_FUNNEL_RESULT}</pre>
                  </div>
                  <p style={{ marginTop: 10 }}>
                    The <code>sql</code> field is the exact query that ran — the same one the Vantage web UI shows. No Vantage API key, no Vantage LLM involved.
                  </p>
                </div>
              </div>
            </div>
          </div>
          <div className="notice info" style={{ margin: '0 16px 16px' }}>
            <Icon name="i-info" />
            <div>
              <b>Illustrative.</b> This transcript is static example text showing the shape of a Claude tool call, not a live query. The real exchange happens in Claude Desktop after you register the server; run the funnel yourself on the <a href="#/funnel">Funnel</a> screen to see live numbers and the real SQL.
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
