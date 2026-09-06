/**
 * mcp-server.factory.ts — builds one MCP `Server` named `vantage` per connection over the shared tool handlers.
 *
 * Why it exists: LLD §1.1 `McpServerFactory`. It is built on the SDK's low-level `Server` rather than the
 * `McpServer` convenience class, because two contract lines cannot be met through it: V13 requires an
 * undeclared tool to be a JSON-RPC `-32601` and `McpServer` answers `-32602`'s text as an `isError` result;
 * and LLD §6 requires a bad spec to be `INVALID_SPEC` with the Zod path in `structuredContent`, where
 * `McpServer` validates input itself and answers unstructured text. So `tools/list` is rendered from the
 * contract table (`MCP_TOOLS`, JSON Schema draft-07 from the Zod objects, the four annotations on every
 * entry) and `tools/call` is: look the name up → validate the arguments against that tool's `inputSchema`
 * → run the handler → validate the output against its `outputSchema` → answer with `structuredContent`
 * and the compact text. A handler's failure of any kind becomes one `McpToolError` (`mcp-errors.ts`); an
 * output that fails its own schema is `INTERNAL`, never sent. A fresh `Server` per `create()` is what
 * lets one process serve a client that disconnected mid-call and then the next one.
 *
 * What it must never do: register a tool the table does not list, answer with a structured result it did
 * not validate, or let a thrown error escape a handler as a JSON-RPC error — only "no such tool" is one.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError, type CallToolResult, type Tool } from '@modelcontextprotocol/sdk/types.js';
import { MCP_SERVER_NAME, MCP_TOOL_ANNOTATIONS, MCP_TOOLS, type McpToolContract, type McpToolError, type McpToolName } from '@vantage/contracts';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { toToolError } from './mcp-errors.js';
import { errorText, renderText } from './mcp-text.js';
import { McpTools } from './mcp-tools.js';

/** `apps/api/package.json`, three levels up from both `src/modules/mcp` and `dist/modules/mcp`. */
const API_PACKAGE = new URL('../../../package.json', import.meta.url);

export function apiVersion(): string {
  return (JSON.parse(readFileSync(API_PACKAGE, 'utf8')) as { version: string }).version;
}

/** Draft-07 is what the SDK itself emits and what its client's Ajv validates without a meta-schema lookup. */
function jsonSchemaOf(schema: z.ZodType, io: 'input' | 'output'): Record<string, unknown> {
  const { $schema: _draft, ...body } = z.toJSONSchema(schema, { io, target: 'draft-7', unrepresentable: 'any' });
  return body;
}

/** The wire shape of one contract row; a union input (`explain_query`) is still an object, which the SDK's `Tool` type requires the root to say. */
export function toolDefinition(tool: McpToolContract): Tool {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: { type: 'object', ...jsonSchemaOf(tool.inputSchema, 'input') },
    outputSchema: { type: 'object', ...jsonSchemaOf(tool.outputSchema, 'output') },
    annotations: { ...MCP_TOOL_ANNOTATIONS },
  };
}

const TOOL_BY_NAME: ReadonlyMap<string, McpToolContract> = new Map(MCP_TOOLS.map((t) => [t.name, t]));

/** A Zod path with symbol keys dropped; a smuggled key (`unrecognized_keys`, reported at the object) is named as the path itself, so `INVALID_SPEC` always points at a field. */
function pathOf(issue: z.core.$ZodIssue): (string | number)[] {
  const base = issue.path.filter((p): p is string | number => typeof p !== 'symbol');
  return issue.code === 'unrecognized_keys' && issue.keys[0] !== undefined ? [...base, issue.keys[0]] : base;
}

function invalidSpec(error: z.ZodError): McpToolError {
  const first = error.issues[0];
  const message = error.issues.map((i) => `${pathOf(i).join('.') || '(root)'}: ${i.message}`).join('; ');
  return first ? { code: 'INVALID_SPEC', message, path: pathOf(first) } : { code: 'INVALID_SPEC', message: 'the input does not fit the schema' };
}

/**
 * An error is `isError: true` with two text blocks — the readable line and the `McpToolError` as JSON — and NO
 * `structuredContent`: the protocol binds `structuredContent` to the tool's `outputSchema`, and the SDK client (so Claude
 * Desktop) rejects a result whose structured content does not fit it, error or not. LLD §6's shape survives in the JSON block.
 */
function errorResult(failure: McpToolError): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: errorText(failure) }, { type: 'text', text: JSON.stringify(failure) }] };
}

@Injectable()
export class McpServerFactory {
  private readonly logger = new Logger('mcp');
  private readonly definitions: readonly Tool[] = MCP_TOOLS.map(toolDefinition);

  constructor(@Inject(McpTools) private readonly tools: McpTools) {}

  create(): Server {
    const handlers = this.tools.handlers();
    const server = new Server({ name: MCP_SERVER_NAME, version: apiVersion() }, { capabilities: { tools: {} } });
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [...this.definitions] }));
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const tool = TOOL_BY_NAME.get(request.params.name);
      if (!tool) throw new McpError(ErrorCode.MethodNotFound, `no tool named ${JSON.stringify(request.params.name)}`);
      // Validated against this tool's own inputSchema two lines down, which is exactly what makes the handler's parameter type true.
      const handler = handlers[tool.name] as (input: unknown) => Promise<unknown>;
      return this.call(tool, handler, request.params.arguments ?? {});
    });
    return server;
  }

  private async call(tool: McpToolContract, handler: (input: unknown) => Promise<unknown>, args: unknown): Promise<CallToolResult> {
    const input = tool.inputSchema.safeParse(args);
    if (!input.success) return errorResult(invalidSpec(input.error));
    let output: unknown;
    try {
      output = await handler(input.data);
    } catch (err) {
      return errorResult(toToolError(err, this.logger));
    }
    const checked = tool.outputSchema.safeParse(output);
    if (!checked.success) {
      this.logger.error(`tool ${tool.name} produced an output its own schema rejects: ${checked.error.message}`);
      return errorResult({ code: 'INTERNAL', message: 'internal error' });
    }
    return {
      content: [{ type: 'text', text: renderText(tool.name as McpToolName, checked.data as never) }],
      structuredContent: checked.data as Record<string, unknown>,
    };
  }
}
