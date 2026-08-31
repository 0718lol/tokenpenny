import { SOURCES, type AgentSource } from '../sources/index.js';
import { table } from '../core/format.js';

export interface SourceDiagnostic {
  id: string;
  name: string;
  dataDir: string;
  detected: boolean;
  status: AgentSource['status'];
  events: number;
  error?: string;
}

export async function inspectSources(sources: AgentSource[] = SOURCES): Promise<SourceDiagnostic[]> {
  const diagnostics: SourceDiagnostic[] = [];
  for (const source of sources) {
    const dataDir = source.dataDir();
    let detected = false;
    try {
      detected = await source.isDetected();
    } catch (error) {
      diagnostics.push({ id: source.id, name: source.name, dataDir, detected: false, status: source.status, events: 0, error: String(error) });
      continue;
    }
    if (!detected) {
      diagnostics.push({ id: source.id, name: source.name, dataDir, detected: false, status: source.status, events: 0 });
      continue;
    }
    try {
      diagnostics.push({ id: source.id, name: source.name, dataDir, detected: true, status: source.status, events: (await source.collectEvents()).length });
    } catch (error) {
      diagnostics.push({ id: source.id, name: source.name, dataDir, detected: true, status: source.status, events: 0, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return diagnostics;
}

export async function doctor(json = false): Promise<void> {
  const sources = await inspectSources();
  if (json) {
    console.log(JSON.stringify({ complete: sources.every((source) => !source.error), sources }, null, 2));
  } else {
    console.log(table(
      ['Agent', 'Detected', 'Status', 'Events', 'Result', 'Data dir'],
      sources.map((source) => [source.name, source.detected ? 'yes' : 'not found', source.status, String(source.events), source.error ? `error: ${source.error}` : 'ok', source.dataDir]),
    ));
  }
  if (sources.some((source) => source.error)) process.exitCode = 2;
}
