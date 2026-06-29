function splitOutputLines(text) {
  return String(text || '').match(/[^\n]*(?:\r?\n|$)/g)?.filter(Boolean) || [];
}

function systemLineParts(line) {
  const newline = line.match(/\r?\n$/)?.[0] || '';
  const body = newline ? line.slice(0, -newline.length) : line;
  const match = body.match(/^(?:\[[^\]]+\]\s+)?\[system\]\s*(.*)$/);
  if (!match) return null;
  return { message: match[1] || '', newline };
}

export function outputEventsFromText(text) {
  const events = [];
  let chunk = '';

  function flushChunk() {
    if (!chunk) return;
    events.push({ type: 'chunk', chunk });
    chunk = '';
  }

  for (const line of splitOutputLines(text)) {
    const system = systemLineParts(line);
    if (!system) {
      chunk += line;
      continue;
    }

    flushChunk();
    events.push({
      type: 'log',
      source: 'system',
      message: system.message,
      chunk: `[system] ${system.message}${system.newline}`,
    });
  }

  flushChunk();
  return events;
}
