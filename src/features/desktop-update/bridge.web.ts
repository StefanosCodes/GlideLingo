import type { DesktopUpdateBridge, DesktopUpdatePhase, DesktopUpdateSnapshot } from './types';

const PACKAGED_RENDERER_ORIGIN = 'https://desktop.glidelingo.com';
const NUMERIC_SEMVER = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
const PHASES = new Set<DesktopUpdatePhase>(['idle', 'checking', 'downloading', 'ready', 'error']);

export function getDesktopUpdateBridge(): DesktopUpdateBridge | null {
  if (typeof window === 'undefined' || window.location.origin !== PACKAGED_RENDERER_ORIGIN) {
    return null;
  }
  const bridge = window.__glidelingoDesktopUpdates;
  if (
    !bridge ||
    typeof bridge.getSnapshot !== 'function' ||
    typeof bridge.subscribe !== 'function' ||
    typeof bridge.retry !== 'function' ||
    typeof bridge.restartAndInstall !== 'function' ||
    typeof bridge.openOfficialDownloadPage !== 'function'
  ) {
    return null;
  }
  return bridge;
}

export function parseDesktopUpdateSnapshot(value: unknown): DesktopUpdateSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<DesktopUpdateSnapshot>;
  if (
    !PHASES.has(candidate.phase as DesktopUpdatePhase) ||
    typeof candidate.required !== 'boolean' ||
    typeof candidate.currentVersion !== 'string' ||
    !NUMERIC_SEMVER.test(candidate.currentVersion) ||
    (candidate.targetVersion !== null &&
      (typeof candidate.targetVersion !== 'string' || !NUMERIC_SEMVER.test(candidate.targetVersion))) ||
    typeof candidate.percent !== 'number' ||
    !Number.isFinite(candidate.percent)
  ) {
    return null;
  }

  return {
    phase: candidate.phase as DesktopUpdatePhase,
    required: candidate.required,
    currentVersion: candidate.currentVersion,
    targetVersion: candidate.targetVersion,
    percent: Math.min(100, Math.max(0, candidate.percent)),
  };
}
