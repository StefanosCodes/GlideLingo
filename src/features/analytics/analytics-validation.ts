import {
  ANALYTICS_EVENT_NAMES,
  ANALYTICS_SURFACES,
  type AnalyticsEventName,
  type AnalyticsEventProperties,
  type ValidatedAnalyticsEvent,
} from './analytics-events';

type Rule =
  | { kind: 'boolean'; optional?: boolean }
  | { kind: 'enum'; values: readonly string[]; optional?: boolean }
  | { kind: 'id'; optional?: boolean }
  | { kind: 'integer'; max: number; min: number; optional?: boolean };

const id = (): Rule => ({ kind: 'id' });
const optionalId = (): Rule => ({ kind: 'id', optional: true });
const integer = (min: number, max: number, optional = false): Rule => ({ kind: 'integer', min, max, optional });
const oneOf = (values: readonly string[]): Rule => ({ kind: 'enum', values });

const EVENT_RULES: Record<AnalyticsEventName, Record<string, Rule>> = {
  screen_viewed: {
    surface: oneOf(ANALYTICS_SURFACES),
    entry_reason: oneOf(['foreground', 'initial', 'navigation']),
  },
  screen_exited: {
    surface: oneOf(ANALYTICS_SURFACES),
    exit_reason: oneOf(['background', 'identity_change', 'navigation']),
    active_duration_ms: integer(0, 86_400_000),
  },
  course_previewed: { course_id: id(), language_id: id() },
  course_started: { course_id: id(), language_id: id() },
  lesson_started: {
    course_id: id(),
    lesson_id: id(),
    lesson_mode: oneOf(['learn', 'review']),
  },
  lesson_beat_viewed: {
    lesson_id: id(),
    lesson_mode: oneOf(['learn', 'review']),
    beat_index: integer(0, 999),
    beat_type: oneOf(['check', 'hear', 'notice']),
  },
  pronunciation_requested: {
    audio_id: id(),
    source: oneOf(['lesson', 'phrase_library']),
    is_repeat: { kind: 'boolean' },
    lesson_id: optionalId(),
    beat_index: integer(0, 999, true),
  },
  pronunciation_failed: {
    audio_id: id(),
    source: oneOf(['lesson', 'phrase_library']),
    failure_kind: oneOf(['asset_missing', 'playback']),
    lesson_id: optionalId(),
    beat_index: integer(0, 999, true),
  },
  answer_submitted: {
    lesson_id: id(),
    lesson_mode: oneOf(['learn', 'review']),
    beat_index: integer(0, 999),
    attempt_number: integer(1, 100),
    result: oneOf(['correct', 'incorrect']),
  },
  lesson_tutor_opened: { lesson_id: id(), beat_index: integer(0, 999) },
  lesson_exited: {
    lesson_id: id(),
    lesson_mode: oneOf(['learn', 'review']),
    beat_index: integer(0, 999),
    exit_reason: oneOf(['abandoned', 'completed_home', 'completed_next']),
  },
  lesson_completed: {
    lesson_id: id(),
    lesson_mode: oneOf(['learn', 'review']),
    beat_count: integer(1, 999),
    attempt_count: integer(0, 10_000),
    recovery_used: { kind: 'boolean' },
  },
};

const PROHIBITED_PROPERTY_PARTS = [
  'answer',
  'auth',
  'callback',
  'card',
  'email',
  'message',
  'name',
  'payment',
  'prompt',
  'query',
  'recording',
  'response',
  'route',
  'text',
  'token',
  'transcript',
  'url',
] as const;

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export function isProhibitedAnalyticsPropertyName(name: string): boolean {
  const normalized = name.toLowerCase();
  return PROHIBITED_PROPERTY_PARTS.some((part) => normalized.includes(part));
}

function matchesRule(value: unknown, rule: Rule): boolean {
  if (value === undefined) return rule.optional === true;
  if (rule.kind === 'boolean') return typeof value === 'boolean';
  if (rule.kind === 'enum') return typeof value === 'string' && rule.values.includes(value);
  if (rule.kind === 'id') return typeof value === 'string' && ID_PATTERN.test(value);
  return typeof value === 'number' && Number.isInteger(value) && value >= rule.min && value <= rule.max;
}

export function validateAnalyticsEvent(
  name: string,
  properties: Record<string, unknown> | null,
): ValidatedAnalyticsEvent | null {
  if (!ANALYTICS_EVENT_NAMES.includes(name as AnalyticsEventName)) return null;
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return null;

  const typedName = name as AnalyticsEventName;
  const rules = EVENT_RULES[typedName];
  const keys = Object.keys(properties);
  if (keys.some((key) => isProhibitedAnalyticsPropertyName(key) || !Object.hasOwn(rules, key))) return null;

  for (const [key, rule] of Object.entries(rules)) {
    if (!matchesRule(properties[key], rule)) return null;
  }

  return {
    name: typedName,
    properties: { ...properties } as AnalyticsEventProperties[typeof typedName],
  } as ValidatedAnalyticsEvent;
}
