export type LoggerLike = {
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
  debug?: (message: string) => void;
};

type Fields = Record<string, unknown>;

function formatFields(fields: Fields): string {
  const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return "";
  const payload: Record<string, unknown> = {};
  for (const [k, v] of entries) payload[k] = v;
  return ` ${JSON.stringify(payload)}`;
}

export function logInfo(logger: LoggerLike, event: string, fields: Fields = {}): void {
  logger.info(`[a2a] ${event}${formatFields(fields)}`);
}

export function logWarn(logger: LoggerLike, event: string, fields: Fields = {}): void {
  logger.warn(`[a2a] ${event}${formatFields(fields)}`);
}

export function logError(logger: LoggerLike, event: string, fields: Fields = {}): void {
  logger.error(`[a2a] ${event}${formatFields(fields)}`);
}
