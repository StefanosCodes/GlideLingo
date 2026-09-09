import type { ElectronApplication, Page, TestInfo } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

export type ObservationLevel = 'info' | 'warning' | 'error';

export type RuntimeObservation = {
  at: string;
  level: ObservationLevel;
  source: string;
  message: string;
};

function sanitize(value: unknown) {
  return String(value)
    .replace(/pk_(?:test|live)_[A-Za-z0-9_-]+/g, '[REDACTED_PUBLISHABLE_KEY]')
    .replace(/(authorization\s*[:=]\s*)([^\s,;]+)/gi, '$1[REDACTED]')
    .replace(/([?&](?:token|code|session|ticket)=)[^&\s]+/gi, '$1[REDACTED]')
    .slice(0, 2_000);
}

function consoleLevel(type: string): ObservationLevel {
  if (type === 'error' || type === 'assert') return 'error';
  if (type === 'warning' || type === 'warn') return 'warning';
  return 'info';
}

export class RuntimeObserver {
  readonly entries: RuntimeObservation[] = [];
  private readonly observedPages = new WeakSet<Page>();

  record(source: string, level: ObservationLevel, message: unknown) {
    this.entries.push({
      at: new Date().toISOString(),
      level,
      source,
      message: sanitize(message),
    });
  }

  observePage(page: Page, label: string) {
    if (this.observedPages.has(page)) return;
    this.observedPages.add(page);

    page.on('console', (message) => {
      this.record(label + ':console', consoleLevel(message.type()), message.text());
    });
    page.on('pageerror', (error) => {
      this.record(label + ':pageerror', 'error', error.stack ?? error.message);
    });
    page.on('requestfailed', (request) => {
      const failure = request.failure()?.errorText ?? 'unknown request failure';
      this.record(label + ':requestfailed', 'error', request.method() + ' ' + request.url() + ' — ' + failure);
    });
    page.on('response', (response) => {
      if (response.status() >= 500) {
        this.record(
          label + ':response',
          'error',
          response.request().method() + ' ' + response.url() + ' — HTTP ' + response.status(),
        );
      }
    });
    page.on('crash', () => {
      this.record(label + ':crash', 'error', 'renderer crashed');
    });
  }

  observeElectron(electronApp: ElectronApplication) {
    electronApp.on('console', (message) => {
      this.record('electron-main:console', consoleLevel(message.type()), message.text());
    });
    electronApp.on('window', (page) => {
      this.observePage(page, 'electron-renderer');
    });

    const child = electronApp.process();
    child.stdout?.on('data', (chunk) => {
      this.record('electron-main:stdout', 'info', chunk);
    });
    child.stderr?.on('data', (chunk) => {
      this.record('electron-main:stderr', 'warning', chunk);
    });
    child.on('exit', (code, signal) => {
      this.record('electron-main:exit', code === 0 || code === null ? 'info' : 'error', 'code=' + code + ' signal=' + signal);
    });
  }

  contains(fragment: string) {
    return this.entries.some((entry) => entry.message.includes(fragment));
  }

  errors() {
    return this.entries.filter((entry) => entry.level === 'error');
  }

  format(entries = this.entries) {
    return entries
      .map((entry) => entry.at + ' [' + entry.level + '] ' + entry.source + ': ' + entry.message)
      .join('\n');
  }

  async attach(testInfo: TestInfo) {
    const artifactPath = testInfo.outputPath('runtime-observations.json');
    await writeFile(artifactPath, JSON.stringify(this.entries, null, 2), 'utf8');
    await testInfo.attach('runtime-observations', {
      path: artifactPath,
      contentType: 'application/json',
    });
  }
}
