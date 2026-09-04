import {
  audioManifest,
  capabilities,
  course,
  languageProfile,
  mission,
  modules,
  pronunciationTargets,
  publication,
  scenario,
} from '@/features/course-catalog/loader/course-schema-validators.generated';
import type {
  CourseSchemaError,
  CourseSchemaValidator,
} from '@/features/course-catalog/loader/course-schema-validators.generated';
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

const validators: Record<SchemaName, CourseSchemaValidator> = {
  course,
  languageProfile,
  capabilities,
  modules,
  mission,
  scenario,
  pronunciationTargets,
  publication,
  audioManifest,
};

function pointerFor(error: CourseSchemaError) {
  if (error.keyword === 'required') {
    return `${error.instancePath}/${String(error.params.missingProperty)}`;
  }
  if (error.keyword === 'additionalProperties') {
    return `${error.instancePath}/${String(error.params.additionalProperty)}`;
  }
  return error.instancePath;
}

function messageFor(error: CourseSchemaError) {
  if (error.keyword === 'enum') {
    return `must be one of: ${(error.params.allowedValues as unknown[]).join(', ')}`;
  }
  if (error.keyword === 'const') return `must equal ${JSON.stringify(error.params.allowedValue)}`;
  return error.message ?? `failed ${error.keyword} validation`;
}

function validate(name: SchemaName, value: unknown, path: string) {
  const validator = validators[name];
  if (validator(value)) return;
  const error = validator.errors?.[0];
  if (!error) throw new Error(`Course schema validator ${JSON.stringify(name)} failed without a diagnostic.`);
  throw new Error(`${path}${pointerFor(error)}: ${messageFor(error)}`);
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
