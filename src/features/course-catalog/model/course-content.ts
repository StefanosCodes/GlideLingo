export type CourseContentSchemaVersion = 1;

export type CourseContentCommunicationMode =
  | 'listening'
  | 'reading'
  | 'spoken-production'
  | 'written-production'
  | 'spoken-interaction'
  | 'written-interaction'
  | 'mediation'
  | 'repair';

export type ActivityRendererType =
  | 'explain'
  | 'listen_choose'
  | 'match'
  | 'order_phrase'
  | 'type_response'
  | 'script_recognition'
  | 'listen_repeat'
  | 'controlled_speak'
  | 'mini_roleplay'
  | 'checkpoint_item'
  | 'reflection';

export type ReviewRecord = {
  status: 'pending' | 'approved' | 'rejected';
  reviewer: string;
  evidence: string;
  reviewedAt?: string | null;
};

export type CourseRecord = {
  schemaVersion: CourseContentSchemaVersion;
  id: string;
  version: string;
  instructionLocale: string;
  targetLocale: string;
  targetVariety: string;
  targetRegister: string;
  learnerSegment: string;
  entryAssumptions: string[];
  intendedProficiencyRange: { entry: string; exit: string };
  productPromise: string;
  exitCapabilityIds: string[];
  stageOrder: string[];
  moduleOrder: string[];
  placementPolicy: { mode: 'fixed-entry' | 'authored-check'; entryCapabilityIds: string[] };
  transliterationPolicy: { mode: 'never' | 'optional' | 'fades' | 'required'; learnerControl: boolean };
  keyboardInputPolicy: { required: boolean; alternatives: string[] };
  supportedProductCapabilities: (
    | 'authored-lessons'
    | 'deterministic-practice'
    | 'guided-conversation'
    | 'offline-learning'
    | 'pronunciation-self-comparison'
    | 'pronunciation-assessment'
  )[];
  publicationRef: string;
};

export type LanguageProfileRecord = {
  schemaVersion: CourseContentSchemaVersion;
  id: string;
  version: string;
  courseId: string;
  writingSystem: { name: string; direction: 'ltr' | 'rtl' | 'vertical' | 'mixed'; segmentation: string };
  pronunciationPriorities: string[];
  transliterationPolicy: string;
  scriptSupportPolicy: string;
  morphologySyntaxProgressionNotes: string[];
  lexicalSelectionPolicy: { principles: string[]; sources: string[] };
  formulaicLanguagePolicy: string;
  pragmaticNorms: string[];
  regionalVariation: string[];
  culturalRepresentationRules: string[];
  speechConstraints: string[];
  ttsConstraints: string[];
  asrConstraints: string[];
  accessibilityInputConstraints: string[];
  externalReferences: string[];
  requiredReviewerQualifications: string[];
  knownLimitations: string[];
};

export type OpportunityRule = {
  minimumOpportunities: number;
  criteria: string[];
  minimumDelayHours?: number;
  permittedSupport?: string[];
};

export type CapabilityRecord = {
  schemaVersion: CourseContentSchemaVersion;
  id: string;
  version: string;
  courseId: string;
  canDo: string;
  domain: string;
  situation: string;
  communicationModes: CourseContentCommunicationMode[];
  prerequisiteCapabilityIds: string[];
  linguisticResources: string[];
  pragmaticCulturalResources: string[];
  teachingMissionIds: string[];
  practiceEvidence: OpportunityRule;
  demonstrationCriteria: OpportunityRule;
  retentionCriteria: OpportunityRule;
  permittedSupport: string[];
  sourceRefs: string[];
};

export type ModuleRecord = {
  schemaVersion: CourseContentSchemaVersion;
  id: string;
  version: string;
  courseId: string;
  stageId: string;
  transformation: string;
  targetCapabilityIds: string[];
  supportingCapabilityIds: string[];
  prerequisiteModuleIds: string[];
  newResources: string[];
  recycledResources: string[];
  likelyLearnerErrors: string[];
  culturalPragmaticFocus: string[];
  missionIds: string[];
  checkpointActivityId: string;
  delayedReviewCapabilityIds: string[];
  estimatedMinutes: number;
  recommendedScenarioIds: string[];
};

export type ActivityChoice = { id: string; text: string };

export type ActivityRecord = {
  schemaVersion: CourseContentSchemaVersion;
  id: string;
  version: string;
  rendererType: ActivityRendererType;
  phase: 'encounter' | 'notice' | 'retrieve' | 'produce' | 'perform' | 'revisit';
  instruction: string;
  prompt: string;
  targetCapabilityIds: string[];
  supportingCapabilityIds: string[];
  communicationMode: CourseContentCommunicationMode;
  usage: 'teaching' | 'practice' | 'assessment' | 'review';
  assessmentEligible: boolean;
  evidenceEligibility: 'none' | 'practice' | 'demonstration' | 'retention' | 'pronunciation';
  supportLevel: 'high' | 'medium' | 'fading' | 'bounded' | 'low';
  hints: string[];
  feedbackContrasts: { when: string; feedback: string }[];
  retryPolicy: { maxAttempts: number; canSkip: boolean };
  accessibility: { instruction: string; nonAudioAlternative?: string };
  assetIds: string[];
  text?: string;
  audioId?: string;
  choices?: ActivityChoice[];
  acceptedChoiceIds?: string[];
  pairs?: { left: string; right: string }[];
  tokens?: string[];
  acceptedOrders?: string[][];
  acceptedResponses?: string[];
  pronunciationTargetId?: string;
  rubric?: { criteria: string[]; minimumMet: number };
  scenarioId?: string;
};

export type LessonRecord = {
  schemaVersion: CourseContentSchemaVersion;
  id: string;
  version: string;
  missionId: string;
  title: string;
  immediateOutcome: string;
  primaryLearnerAction: string;
  entryState: string;
  durationMinutes: number;
  activities: ActivityRecord[];
  newMaterial: string[];
  recycledMaterial: string[];
  feedbackRetryBehavior: string;
  completionCondition: { type: 'all-required-activities'; requiredActivityIds: string[] };
  safeResumeActivityIds: string[];
  assetIds: string[];
};

export type MissionAssetRecord = {
  id: string;
  type: 'image' | 'document' | 'interaction';
  path: string;
  description: string;
};

export type MissionRecord = {
  schemaVersion: CourseContentSchemaVersion;
  id: string;
  version: string;
  courseId: string;
  moduleId: string;
  title: string;
  realWorldJob: string;
  learnerRole: string;
  otherRoles: string[];
  targetCapabilityIds: string[];
  supportingCapabilityIds: string[];
  prerequisiteCapabilityIds: string[];
  completionCondition: { type: 'all-required-activities'; requiredActivityIds: string[] };
  lessonOrder: string[];
  lessons: LessonRecord[];
  supportFadingPlan: ('model' | 'constrained-choice' | 'cued-recall' | 'free-response' | 'varied-transfer')[];
  checkpointActivityIds: string[];
  reviewActivityIds: string[];
  interruptionResume: { boundary: 'activity'; behavior: string };
  offline: { supported: boolean; unavailableActivityIds: string[] };
  accessibilityAlternatives: string[];
  assets: MissionAssetRecord[];
  reviewerRefs: string[];
  sourceRefs: string[];
};

export type ScenarioRecord = {
  schemaVersion: CourseContentSchemaVersion;
  id: string;
  version: string;
  courseId: string;
  moduleId: string;
  targetCapabilityIds: string[];
  supportingCapabilityIds: string[];
  setting: string;
  learnerGoal: string;
  role: { name: string; persona: string };
  languageLevel: string;
  allowedResources: string[];
  authoredOpening: string;
  hintLadder: string[];
  correctionPolicy: string;
  targetTurnRange: { minimum: number; maximum: number };
  maximumDurationSeconds: number;
  successObservations: { id: string; description: string }[];
  completionRule: { type: 'all-required-observations'; requiredObservationIds: string[] };
  evidenceMapping: { observationId: string; capabilityId: string; level: 'practice' | 'demonstration' }[];
  safeExits: string[];
  conversationProfileId: string;
};

export type PronunciationTargetRecord = {
  schemaVersion: CourseContentSchemaVersion;
  id: string;
  version: string;
  courseId: string;
  text: string;
  locale: string;
  targetVariety: string;
  syllables: string[];
  stressTarget: string;
  phoneticRepresentation?: string;
  targetAudioIds: string[];
  acceptableVariants: string[];
  commonLearnerErrors: string[];
  feedbackTemplates: { code: string; template: string }[];
  assessmentEligibility: { eligible: boolean; evaluatorVersion?: string; confidenceThreshold?: number };
  review: { reviewer: string; status: ReviewRecord['status']; reviewedAt: string | null };
};

export type PublicationRecord = {
  schemaVersion: CourseContentSchemaVersion;
  id: string;
  version: string;
  courseId: string;
  courseVersion: string;
  status: 'draft' | 'published' | 'retired';
  sourceRevision: string;
  schemaVersions: Record<string, number>;
  contentHash: string;
  provenance: { kind: 'authored' | 'generated' | 'adapted'; description: string }[];
  validatorReport: { command: 'npm run course:validate'; status: 'pending' | 'passed' | 'failed'; validatedAt: string | null };
  reviews: Record<string, ReviewRecord>;
  knownLimitations: string[];
  migrationCompatibility: string;
  publishedAt: string | null;
  retiredAt: string | null;
};

export type AudioClipRecord = {
  id: string;
  lessonId: string;
  profile: string;
  text: string;
};

export type CoursePackage = {
  course: CourseRecord;
  languageProfile: LanguageProfileRecord;
  capabilities: CapabilityRecord[];
  modules: ModuleRecord[];
  missions: MissionRecord[];
  scenarios: ScenarioRecord[];
  pronunciationTargets: PronunciationTargetRecord[];
  publication: PublicationRecord;
  audioClips: AudioClipRecord[];
};

export type CoursePackageSource = {
  course: unknown;
  languageProfile: unknown;
  capabilities: unknown;
  modules: unknown;
  missions: readonly unknown[];
  scenarios: readonly unknown[];
  pronunciationTargets: unknown;
  publication: unknown;
  audioManifest: unknown;
};

export type CoursePackageLookups = {
  courses: ReadonlyMap<string, CourseRecord>;
  modules: ReadonlyMap<string, ModuleRecord>;
  missions: ReadonlyMap<string, MissionRecord>;
  lessons: ReadonlyMap<string, LessonRecord>;
  activities: ReadonlyMap<string, ActivityRecord>;
  capabilities: ReadonlyMap<string, CapabilityRecord>;
  scenarios: ReadonlyMap<string, ScenarioRecord>;
  pronunciationTargets: ReadonlyMap<string, PronunciationTargetRecord>;
  audioClips: ReadonlyMap<string, AudioClipRecord>;
  assets: ReadonlyMap<string, MissionAssetRecord>;
};

export type LoadedCoursePackage = CoursePackage & { lookups: CoursePackageLookups };
