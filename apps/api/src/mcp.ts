/**
 * mcp.ts — the stdio MCP entrypoint: read config, boot the Nest context without HTTP, self-test, serve stdin/stdout.
 *
 * Why it exists: `node apps/api/dist/mcp.js` is what Claude Desktop or Claude Code spawns (design §5.2).
 * It builds `McpRootModule` with `NestFactory.createApplicationContext` — the database module's boot
 * self-test runs exactly as it does for the HTTP API, and a refusal exits 1 before a byte of protocol is
 * written — then connects one `Server` to `StdioServerTransport`. stdout is the protocol channel, so every
 * log line, Nest's included, goes to stderr through `StderrLogger`; a stray `console.log` anywhere on the
 * read path would corrupt the stream, and the e2e suite asserts that every stdout line parses as
 * JSON-RPC. When the client goes away (stdin ends, the transport closes, or the process is signalled) the
 * Nest context is closed so both pools end, and the process exits 0.
 *
 * What it must never do: write to stdout itself, listen on a port, construct a model adapter, or keep
 * running after its client is gone.
 */
import type { LoggerService } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import 'reflect-metadata';
import { loadConfig } from './infra/config.js';
import { loadMcpOptions } from './modules/mcp/mcp-options.js';
import { McpServerFactory } from './modules/mcp/mcp-server.factory.js';
import { McpRootModule } from './modules/mcp/mcp.module.js';

/** Every level to stderr: stdout belongs to the protocol. */
export class StderrLogger implements LoggerService {
  private write(level: string, message: unknown, context?: unknown): void {
    const where = typeof context === 'string' ? ` ${context}` : '';
    process.stderr.write(`[vantage mcp ${level}]${where} ${typeof message === 'string' ? message : JSON.stringify(message)}\n`);
  }
  log(message: unknown, context?: unknown): void {
    this.write('log', message, context);
  }
  error(message: unknown, ...rest: unknown[]): void {
    this.write('error', message, rest[rest.length - 1]);
  }
  warn(message: unknown, context?: unknown): void {
    this.write('warn', message, context);
  }
  debug(message: unknown, context?: unknown): void {
    this.write('debug', message, context);
  }
  verbose(message: unknown, context?: unknown): void {
    this.write('verbose', message, context);
  }
}

async function main(): Promise<void> {
  const logger = new StderrLogger();
  const config = loadConfig();
  const options = loadMcpOptions();
  const context = await NestFactory.createApplicationContext(
    McpRootModule.forRoot({ rwUrl: config.rwUrl, roUrl: config.roUrl, ownerUrl: config.ownerUrl, migrationRole: config.migrationRole, migrationsDir: config.migrationsDir }, options),
    { logger },
  );
  const server = context.get(McpServerFactory).create();
  const transport = new StdioServerTransport();

  let closing = false;
  const shutdown = (reason: string): void => {
    if (closing) return;
    closing = true;
    logger.log(`shutting down: ${reason}`, 'mcp');
    server
      .close()
      .catch(() => undefined)
      .then(() => context.close())
      .then(() => process.exit(0), (err: unknown) => {
        logger.error(err instanceof Error ? err.message : String(err), 'mcp');
        process.exit(1);
      });
  };
  server.onclose = () => shutdown('transport closed');
  process.stdin.once('end', () => shutdown('stdin ended'));
  process.stdin.once('close', () => shutdown('stdin closed'));
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));

  await server.connect(transport);
  logger.log(`serving over stdio; plans ${options.exposePlans ? 'exposed' : 'hidden'}`, 'mcp');
}

main().catch((err: unknown) => {
  process.stderr.write(`vantage mcp refused to start: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
