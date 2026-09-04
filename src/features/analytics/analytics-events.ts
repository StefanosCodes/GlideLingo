export const ANALYTICS_EVENT_NAMES = [
  'screen_viewed',
  'screen_exited',
  'course_previewed',
  'course_started',
  'lesson_started',
  'lesson_beat_viewed',
  'pronunciation_requested',
  'pronunciation_failed',
  'answer_submitted',
  'lesson_tutor_opened',
  'lesson_exited',
  'lesson_completed',
] as const;

export type AnalyticsEventName = (typeof ANALYTICS_EVENT_NAMES)[number];

export const ANALYTICS_SURFACES = [
  'auth_forgot_password',
  'auth_sign_in',
  'auth_sign_up',
  'course_preview',
  'diagnostics',
  'home',
  'kit',
  'lesson',
  'letters',
  'phrases',
  'profile',
  'progress',
  'quests',
  'review',
  'rhythm',
  'sso_callback',
  'subscription',
  'unknown',
] as const;

export type AnalyticsSurface = (typeof ANALYTICS_SURFACES)[number];
export type LessonMode = 'learn' | 'review';

export type AnalyticsEventProperties = {
  screen_viewed: {
    surface: AnalyticsSurface;
    entry_reason: 'foreground' | 'initial' | 'navigation';
  };
  screen_exited: {
    surface: AnalyticsSurface;
    exit_reason: 'background' | 'identity_change' | 'navigation';
    active_duration_ms: number;
  };
  course_previewed: {
    course_id: string;
    language_id: string;
  };
  course_started: {
    course_id: string;
    language_id: string;
  };
  lesson_started: {
    course_id: string;
    lesson_id: string;
    lesson_mode: LessonMode;
  };
  lesson_beat_viewed: {
    lesson_id: string;
    lesson_mode: LessonMode;
    beat_index: number;
    beat_type: 'check' | 'hear' | 'notice';
  };
  pronunciation_requested: {
    audio_id: string;
    source: 'lesson' | 'phrase_library';
    is_repeat: boolean;
    lesson_id?: string;
    beat_index?: number;
  };
  pronunciation_failed: {
    audio_id: string;
    source: 'lesson' | 'phrase_library';
    failure_kind: 'asset_missing' | 'playback';
    lesson_id?: string;
    beat_index?: number;
  };
  answer_submitted: {
    lesson_id: string;
    lesson_mode: LessonMode;
    beat_index: number;
    attempt_number: number;
    result: 'correct' | 'incorrect';
  };
  lesson_tutor_opened: {
    lesson_id: string;
    beat_index: number;
  };
  lesson_exited: {
    lesson_id: string;
    lesson_mode: LessonMode;
    beat_index: number;
    exit_reason: 'abandoned' | 'completed_home' | 'completed_next';
  };
  lesson_completed: {
    lesson_id: string;
    lesson_mode: LessonMode;
    beat_count: number;
    attempt_count: number;
    recovery_used: boolean;
  };
};

export type AnalyticsEnvironment = 'preview' | 'production' | 'staging';
export type AnalyticsRuntimeSurface = 'android' | 'electron' | 'ios' | 'web';

export type AnalyticsContextProperties = {
  schema_version: 1;
  analytics_environment: AnalyticsEnvironment;
  runtime_surface: AnalyticsRuntimeSurface;
  app_version: string;
};

export type ValidatedAnalyticsEvent = {
  [Name in AnalyticsEventName]: {
    name: Name;
    properties: AnalyticsEventProperties[Name];
  };
}[AnalyticsEventName];

export type AnalyticsPayload = ValidatedAnalyticsEvent & {
  context: AnalyticsContextProperties;
};
