import Ajv2020, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js';

import activitySchema from '../../../../content/schemas/course-content/v1/activity.schema.json';
import audioManifestSchema from '../../../../content/schemas/course-content/v1/audio-manifest.schema.json';
import capabilitiesSchema from '../../../../content/schemas/course-content/v1/capabilities.schema.json';
import commonSchema from '../../../../content/schemas/course-content/v1/common.schema.json';
import courseSchema from '../../../../content/schemas/course-content/v1/course.schema.json';
import languageProfileSchema from '../../../../content/schemas/course-content/v1/language-profile.schema.json';
import lessonSchema from '../../../../content/schemas/course-content/v1/lesson.schema.json';
import missionSchema from '../../../../content/schemas/course-content/v1/mission.schema.json';
import modulesSchema from '../../../../content/schemas/course-content/v1/modules.schema.json';
import pronunciationTargetsSchema from '../../../../content/schemas/course-content/v1/pronunciation-targets.schema.json';
import publicationSchema from '../../../../content/schemas/course-content/v1/publication.schema.json';
import scenarioSchema from '../../../../content/schemas/course-content/v1/scenario.schema.json';

import type { CoursePackageSource } from '@/features/course-catalog/model/course-content';

type SchemaName =
  | 'course'
  | 'languageProfile'
  | 'capabilities'
  | 'modules'
  | 'mission'
  | 'scenario'
  | 'pronunciationTargets'
  | 'publication'
  | 'audioManifest';

const schemaIds: Record<SchemaName, string> = {
  course: 'https://glidelingo.app/schemas/course-content/v1/course.schema.json',
  languageProfile: 'https://glidelingo.app/schemas/course-content/v1/language-profile.schema.json',
  capabilities: 'https://glidelingo.app/schemas/course-content/v1/capabilities.schema.json',
  modules: 'https://glidelingo.app/schemas/course-content/v1/modules.schema.json',
  mission: 'https://glidelingo.app/schemas/course-content/v1/mission.schema.json',
  scenario: 'https://glidelingo.app/schemas/course-content/v1/scenario.schema.json',
  pronunciationTargets: 'https://glidelingo.app/schemas/course-content/v1/pronunciation-targets.schema.json',
  publication: 'https://glidelingo.app/schemas/course-content/v1/publication.schema.json',
  audioManifest: 'https://glidelingo.app/schemas/course-content/v1/audio-manifest.schema.json',
};

function validUri(value: string) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

function validDateTime(value: string) {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && !Number.isNaN(Date.parse(value));
}

const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
ajv.addFormat('uri', { type: 'string', validate: validUri });
ajv.addFormat('date-time', { type: 'string', validate: validDateTime });
for (const schema of [
  commonSchema,
  activitySchema,
  audioManifestSchema,
  capabilitiesSchema,
  courseSchema,
  languageProfileSchema,
  lessonSchema,
  missionSchema,
  modulesSchema,
  pronunciationTargetsSchema,
  publicationSchema,
  scenarioSchema,
]) ajv.addSchema(schema);

const validators = Object.fromEntries(
  Object.entries(schemaIds).map(([name, id]) => [name, ajv.getSchema(id)]),
) as Record<SchemaName, ValidateFunction | undefined>;

function pointerFor(error: ErrorObject) {
  if (error.keyword === 'required') {
    return `${error.instancePath}/${String(error.params.missingProperty)}`;
  }
  if (error.keyword === 'additionalProperties') {
    return `${error.instancePath}/${String(error.params.additionalProperty)}`;
  }
  return error.instancePath;
}

function messageFor(error: ErrorObject) {
  if (error.keyword === 'enum') {
    return `must be one of: ${(error.params.allowedValues as unknown[]).join(', ')}`;
  }
  if (error.keyword === 'const') return `must equal ${JSON.stringify(error.params.allowedValue)}`;
  return error.message ?? `failed ${error.keyword} validation`;
}

function validate(name: SchemaName, value: unknown, path: string) {
  const validator = validators[name];
  if (!validator) throw new Error(`Course schema validator ${JSON.stringify(name)} is unavailable.`);
  if (validator(value)) return;
  const error = validator.errors?.[0];
  if (!error) throw new Error(`Course schema validator ${JSON.stringify(name)} failed without a diagnostic.`);
  const pointer = pointerFor(error);
  throw new Error(`${path}${pointer}: ${messageFor(error)}`);
}

export function validateCoursePackageSourceSchema(source: CoursePackageSource) {
  validate('course', source.course, 'course.json');
  validate('languageProfile', source.languageProfile, 'language-profile.json');
  validate('capabilities', source.capabilities, 'capabilities.json');
  validate('modules', source.modules, 'modules.json');
  source.missions.forEach((mission, index) => validate('mission', mission, `missions/${index}`));
  source.scenarios.forEach((scenario, index) => validate('scenario', scenario, `scenarios/${index}`));
  validate('pronunciationTargets', source.pronunciationTargets, 'pronunciation/targets.json');
  validate('publication', source.publication, 'publication.json');
  validate('audioManifest', source.audioManifest, 'audio-manifest.json');
}
