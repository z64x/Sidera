import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { ConsoleLogEntry } from '../shared/types';

type LogLevel = 'log' | 'info' | 'warn' | 'error';

type LogPayload = Record<string, unknown>;

const originalConsole = {
  log: console.log.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
};

let consoleLoggingInstalled = false;

function roundSeconds(value?: number | null): number | null {
  if (value === null || value === undefined) return null;
  return Math.round((value / 1000) * 100) / 100;
}

function normalizeSecondsInValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeSecondsInValue);
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const normalized: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'number' && (key.endsWith('Ms') || key.includes('ms'))) {
      const normalizedKey = key.replace(/Ms$/g, 'Seconds').replace(/ms/g, 'seconds');
      normalized[normalizedKey] = roundSeconds(entry);
      continue;
    }

    normalized[key] = normalizeSecondsInValue(entry);
  }

  return normalized;
}

function getLogFilePath(): string {
  return path.join(app.getPath('userData'), 'logs', 'console.log');
}

function serializeArg(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (typeof value === 'function') {
    return `[Function ${value.name || 'anonymous'}]`;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => serializeArg(entry, seen));
  }

  if (value && typeof value === 'object') {
    if (seen.has(value)) {
      return '[Circular]';
    }

    seen.add(value);
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      output[key] = serializeArg(entry, seen);
    }
    seen.delete(value);
    return output;
  }

  return value;
}

function stringifyArg(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.stack || `${value.name}: ${value.message}`;

  try {
    return JSON.stringify(serializeArg(value));
  } catch {
    return String(value);
  }
}

function buildEntry(level: LogLevel, source: 'main' | 'renderer', args: unknown[]): ConsoleLogEntry {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    timestamp: new Date().toISOString(),
    level,
    source,
    message: args.map(stringifyArg).join(' '),
    data: args.map((arg) => serializeArg(arg)),
  };
}

function appendEntry(entry: ConsoleLogEntry): void {
  try {
    const logFilePath = getLogFilePath();
    fs.mkdirSync(path.dirname(logFilePath), { recursive: true });
    fs.appendFileSync(logFilePath, `${JSON.stringify(entry)}\n`, 'utf8');
  } catch {
    // Avoid recursive console writes if persistence fails.
  }
}

export function persistConsoleLog(level: LogLevel, source: 'main' | 'renderer', args: unknown[]): void {
  appendEntry(buildEntry(level, source, args));
}

export function initializeConsoleLogging(): void {
  if (consoleLoggingInstalled) return;
  consoleLoggingInstalled = true;

  (['log', 'info', 'warn', 'error'] as const).forEach((level) => {
    console[level] = (...args: unknown[]) => {
      appendEntry(buildEntry(level, 'main', args));
      originalConsole[level](...args);
    };
  });
}

export function getConsoleLogs(): ConsoleLogEntry[] {
  try {
    const logFilePath = getLogFilePath();
    if (!fs.existsSync(logFilePath)) return [];

    return fs
      .readFileSync(logFilePath, 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as ConsoleLogEntry)
      .filter((entry) => entry && typeof entry.message === 'string' && typeof entry.timestamp === 'string');
  } catch {
    return [];
  }
}

export function clearConsoleLogs(): void {
  try {
    const logFilePath = getLogFilePath();
    fs.mkdirSync(path.dirname(logFilePath), { recursive: true });
    fs.writeFileSync(logFilePath, '', 'utf8');
  } catch {
    // Ignore clear failures; callers do not need crash-level behavior for log cleanup.
  }
}

function emit(level: Exclude<LogLevel, 'log'>, scope: string, event: string, payload?: LogPayload): void {
  const logger = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  logger(`[${scope}] ${event}`, normalizeSecondsInValue(payload || {}));
}

export function secondsFromMs(value?: number | null): number | null {
  return roundSeconds(value);
}

export function logInfo(scope: string, event: string, payload?: LogPayload): void {
  emit('info', scope, event, payload);
}

export function logWarn(scope: string, event: string, payload?: LogPayload): void {
  emit('warn', scope, event, payload);
}

export function logError(scope: string, event: string, payload?: LogPayload): void {
  emit('error', scope, event, payload);
}
