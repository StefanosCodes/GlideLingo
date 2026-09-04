import { createHash } from 'node:crypto';
import { access, lstat, readFile, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Ajv2020 from 'ajv/dist/2020.js';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
export const workspaceRoot = path.resolve(scriptDirectory, '..', '..');
export const schemaDirectory = path.join(workspaceRoot, 'content', 'schemas', 'course-content', 'v1');

const schemaIds = {
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

function slash(value) {
  return value.split(path.sep).join('/');
}

function escapePointer(value) {
  return String(value).replaceAll('~', '~0').replaceAll('/', '~1');
}

function pointerJoin(base, value) {
  return `${base}/${escapePointer(value)}`;
}

function displayPath(filename, root) {
  const relative = path.relative(root, filename);
  return relative.startsWith('..') ? slash(path.resolve(filename)) : slash(relative);
}

function diagnostic(file, pointer, code, message) {
  return { file, pointer: pointer || '/', code, message };
}

function sortDiagnostics(diagnostics) {
  return diagnostics.sort((left, right) =>
    left.file.localeCompare(right.file)
    || left.pointer.localeCompare(right.pointer)
    || left.code.localeCompare(right.code)
    || left.message.localeCompare(right.message));
}

function validUri(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

function validDateTime(value) {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && !Number.isNaN(Date.parse(value));
}

async function createSchemaValidators() {
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
  ajv.addFormat('uri', { type: 'string', validate: validUri });
  ajv.addFormat('date-time', { type: 'string', validate: validDateTime });

  const names = (await readdir(schemaDirectory)).filter((name) => name.endsWith('.json')).sort();
  for (const name of names) {
    const schema = JSON.parse(await readFile(path.join(schemaDirectory, name), 'utf8'));
    ajv.addSchema(schema);
  }

  return Object.fromEntries(
    Object.entries(schemaIds).map(([name, id]) => {
      const validate = ajv.getSchema(id);
      if (!validate) throw new Error(`Schema ${id} was not registered.`);
      return [name, validate];
    }),
  );
}

let schemaValidatorsPromise;

function getSchemaValidators() {
  schemaValidatorsPromise ??= createSchemaValidators();
  return schemaValidatorsPromise;
}

function schemaErrorPointer(error) {
  if (error.keyword === 'required') return pointerJoin(error.instancePath, error.params.missingProperty);
  if (error.keyword === 'additionalProperties') return pointerJoin(error.instancePath, error.params.additionalProperty);
  return error.instancePath || '/';
}

function schemaErrorMessage(error) {
  if (error.keyword === 'enum') {
    return `must be one of: ${error.params.allowedValues.join(', ')}`;
  }
  if (error.keyword === 'const') return `must equal ${JSON.stringify(error.params.allowedValue)}`;
  return error.message ?? `failed ${error.keyword} validation`;
}

async function exists(filename) {
  try {
    await access(filename);
    return true;
  } catch {
    return false;
  }
}

async function readJsonDocument(filename, root, schemaName, diagnostics) {
  const file = displayPath(filename, root);
  try {
    return {
      absolutePath: filename,
      file,
      schemaName,
      data: JSON.parse(await readFile(filename, 'utf8')),
    };
  } catch (error) {
    diagnostics.push(diagnostic(file, '/', 'invalid-json', `could not read valid JSON: ${error.message}`));
    return null;
  }
}

async function readRequiredJson(packageDirectory, relativePath, root, schemaName, diagnostics) {
  const filename = path.join(packageDirectory, relativePath);
  if (!(await exists(filename))) {
    diagnostics.push(diagnostic(displayPath(filename, root), '/', 'missing-file', 'required course package file is missing'));
    return null;
  }
  return readJsonDocument(filename, root, schemaName, diagnostics);
}

async function readJsonDirectory(
  packageDirectory,
  relativeDirectory,
  root,
  schemaName,
  diagnostics,
  { required = true } = {},
) {
  const directory = path.join(packageDirectory, relativeDirectory);
  let entries;
  try {
    entries = (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if (!required && error.code === 'ENOENT') return [];
    diagnostics.push(diagnostic(displayPath(directory, root), '/', 'missing-directory', `required directory is unavailable: ${error.message}`));
    return [];
  }
  if (required && entries.length === 0) {
    diagnostics.push(diagnostic(displayPath(directory, root), '/', 'missing-file', 'at least one JSON record is required'));
    return [];
  }
  const documents = [];
  for (const name of entries) {
    const document = await readJsonDocument(path.join(directory, name), root, schemaName, diagnostics);
    if (document) documents.push(document);
  }
  return documents;
}

async function loadPackage(packageDirectory, root) {
  const diagnostics = [];
  const course = await readRequiredJson(packageDirectory, 'course.json', root, 'course', diagnostics);
  const languageProfile = await readRequiredJson(packageDirectory, 'language-profile.json', root, 'languageProfile', diagnostics);
  const capabilities = await readRequiredJson(packageDirectory, 'capabilities.json', root, 'capabilities', diagnostics);
  const modules = await readRequiredJson(packageDirectory, 'modules.json', root, 'modules', diagnostics);
  const missions = await readJsonDirectory(packageDirectory, 'missions', root, 'mission', diagnostics);
  const scenarios = await readJsonDirectory(
    packageDirectory,
    'scenarios',
    root,
    'scenario',
    diagnostics,
    { required: false },
  );
  const pronunciationTargets = await readRequiredJson(
    packageDirectory,
    path.join('pronunciation', 'targets.json'),
    root,
    'pronunciationTargets',
    diagnostics,
  );
  const publication = await readRequiredJson(packageDirectory, 'publication.json', root, 'publication', diagnostics);
  const audioManifest = await readRequiredJson(packageDirectory, 'audio-manifest.json', root, 'audioManifest', diagnostics);
  return {
    packageDirectory,
    diagnostics,
    course,
    languageProfile,
    capabilities,
    modules,
    missions,
    scenarios,
    pronunciationTargets,
    publication,
    audioManifest,
  };
}

function validateSchemas(loaded, validators) {
  const documents = [
    loaded.course,
    loaded.languageProfile,
    loaded.capabilities,
    loaded.modules,
    ...loaded.missions,
    ...loaded.scenarios,
    loaded.pronunciationTargets,
    loaded.publication,
    loaded.audioManifest,
  ].filter(Boolean);
  for (const document of documents) {
    const validate = validators[document.schemaName];
    if (validate(document.data)) continue;
    for (const error of validate.errors ?? []) {
      loaded.diagnostics.push(diagnostic(
        document.file,
        schemaErrorPointer(error),
        'schema',
        schemaErrorMessage(error),
      ));
    }
  }
}

function addRecord(registry, record, location, diagnostics) {
  const previous = registry.get(record.id);
  if (previous) {
    diagnostics.push(diagnostic(
      location.file,
      `${location.pointer}/id`,
      'duplicate-id',
      `record ID ${JSON.stringify(record.id)} duplicates ${previous.file}:${previous.pointer}/id`,
    ));
    return;
  }
  registry.set(record.id, { ...location, record });
}

function locationsFor(loaded) {
  const records = new Map();
  const course = { record: loaded.course.data, file: loaded.course.file, pointer: '' };
  const languageProfile = { record: loaded.languageProfile.data, file: loaded.languageProfile.file, pointer: '' };
  const capabilities = loaded.capabilities.data.capabilities.map((record, index) => ({
    record,
    file: loaded.capabilities.file,
    pointer: `/capabilities/${index}`,
  }));
  const modules = loaded.modules.data.modules.map((record, index) => ({
    record,
    file: loaded.modules.file,
    pointer: `/modules/${index}`,
  }));
  const missions = loaded.missions.map((document) => ({ record: document.data, file: document.file, pointer: '' }));
  const lessons = [];
  const activities = [];
  for (const mission of missions) {
    mission.record.lessons.forEach((record, lessonIndex) => {
      const lesson = { record, file: mission.file, pointer: `/lessons/${lessonIndex}`, mission };
      lessons.push(lesson);
      record.activities.forEach((activity, activityIndex) => {
        activities.push({
          record: activity,
          file: mission.file,
          pointer: `/lessons/${lessonIndex}/activities/${activityIndex}`,
          mission,
          lesson,
        });
      });
    });
  }
  const scenarios = loaded.scenarios.map((document) => ({ record: document.data, file: document.file, pointer: '' }));
  const pronunciationTargets = loaded.pronunciationTargets.data.targets.map((record, index) => ({
    record,
    file: loaded.pronunciationTargets.file,
    pointer: `/targets/${index}`,
  }));
  const publication = { record: loaded.publication.data, file: loaded.publication.file, pointer: '' };
  const audioClips = loaded.audioManifest.data.clips.map((record, index) => ({
    record,
    file: loaded.audioManifest.file,
    pointer: `/clips/${index}`,
  }));

  for (const location of [
    course,
    languageProfile,
    ...capabilities,
    ...modules,
    ...missions,
    ...lessons,
    ...activities,
    ...scenarios,
    ...pronunciationTargets,
    ...audioClips,
    publication,
  ]) addRecord(records, location.record, location, loaded.diagnostics);

  return {
    records,
    course,
    languageProfile,
    capabilities,
    modules,
    missions,
    lessons,
    activities,
    scenarios,
    pronunciationTargets,
    audioClips,
    publication,
  };
}

function byId(locations) {
  return new Map(locations.map((location) => [location.record.id, location]));
}

function checkReferences(values, map, location, pointer, kind, diagnostics) {
  values.forEach((value, index) => {
    if (map.has(value)) return;
    diagnostics.push(diagnostic(
      location.file,
      `${location.pointer}${pointer}/${index}`,
      'missing-reference',
      `${kind} ${JSON.stringify(value)} does not exist`,
    ));
  });
}

function checkReference(value, map, location, pointer, kind, diagnostics) {
  if (map.has(value)) return;
  diagnostics.push(diagnostic(
    location.file,
    `${location.pointer}${pointer}`,
    'missing-reference',
    `${kind} ${JSON.stringify(value)} does not exist`,
  ));
}

function checkCourseId(location, courseId, diagnostics) {
  if (location.record.courseId === courseId) return;
  diagnostics.push(diagnostic(
    location.file,
    `${location.pointer}/courseId`,
    'course-mismatch',
    `must reference course ${JSON.stringify(courseId)}`,
  ));
}

function checkOrder(order, members, location, pointer, kind, diagnostics) {
  checkReferences(order, members, location, pointer, kind, diagnostics);
  const orderSet = new Set(order);
  for (const id of members.keys()) {
    if (orderSet.has(id)) continue;
    diagnostics.push(diagnostic(
      location.file,
      `${location.pointer}${pointer}`,
      'missing-order-entry',
      `${kind} ${JSON.stringify(id)} is not included in the authored order`,
    ));
  }
}

function findCycles(locations, prerequisitesFor, label, diagnostics) {
  const map = byId(locations);
  const state = new Map();
  const stack = [];

  function visit(id) {
    const currentState = state.get(id);
    if (currentState === 'done') return;
    if (currentState === 'visiting') return;
    state.set(id, 'visiting');
    stack.push(id);
    const location = map.get(id);
    const prerequisites = prerequisitesFor(location.record);
    prerequisites.forEach((prerequisiteId, index) => {
      if (!map.has(prerequisiteId)) return;
      if (state.get(prerequisiteId) === 'visiting') {
        const cycleStart = stack.indexOf(prerequisiteId);
        const cycle = [...stack.slice(cycleStart), prerequisiteId];
        diagnostics.push(diagnostic(
          location.file,
          `${location.pointer}/${label}/${index}`,
          'prerequisite-cycle',
          `prerequisite cycle detected: ${cycle.join(' -> ')}`,
        ));
        return;
      }
      visit(prerequisiteId);
    });
    stack.pop();
    state.set(id, 'done');
  }

  for (const id of map.keys()) visit(id);
}

function checkCapabilityReachability(course, capabilities, diagnostics) {
  const map = byId(capabilities);
  const reachable = new Set(
    capabilities.filter(({ record }) => record.prerequisiteCapabilityIds.length === 0).map(({ record }) => record.id),
  );
  let changed = true;
  while (changed) {
    changed = false;
    for (const { record } of capabilities) {
      if (reachable.has(record.id)) continue;
      if (record.prerequisiteCapabilityIds.every((id) => reachable.has(id))) {
        reachable.add(record.id);
        changed = true;
      }
    }
  }
  course.record.exitCapabilityIds.forEach((id, index) => {
    if (!map.has(id) || reachable.has(id)) return;
    diagnostics.push(diagnostic(
      course.file,
      `/exitCapabilityIds/${index}`,
      'unreachable-exit',
      `exit capability ${JSON.stringify(id)} is not reachable from an entry capability`,
    ));
  });
}

function checkActivityAnswerContract(activity, diagnostics) {
  const { record, file, pointer } = activity;
  if (record.acceptedChoiceIds) {
    const choiceIds = new Set();
    const choiceTexts = new Set();
    record.choices.forEach((choice, index) => {
      if (choiceIds.has(choice.id)) {
        diagnostics.push(diagnostic(file, `${pointer}/choices/${index}/id`, 'duplicate-id', `choice ID ${JSON.stringify(choice.id)} is duplicated in this activity`));
      } else choiceIds.add(choice.id);
      if (choiceTexts.has(choice.text)) {
        diagnostics.push(diagnostic(file, `${pointer}/choices/${index}/text`, 'duplicate-choice', `choice text ${JSON.stringify(choice.text)} is duplicated in this activity`));
      } else choiceTexts.add(choice.text);
    });
    record.acceptedChoiceIds.forEach((id, index) => {
      if (choiceIds.has(id)) return;
      diagnostics.push(diagnostic(file, `${pointer}/acceptedChoiceIds/${index}`, 'invalid-answer', `accepted choice ${JSON.stringify(id)} is absent from choices`));
    });
  }
  if (record.acceptedOrders) {
    const tokens = new Set(record.tokens);
    record.acceptedOrders.forEach((order, orderIndex) => {
      order.forEach((token, tokenIndex) => {
        if (tokens.has(token)) return;
        diagnostics.push(diagnostic(file, `${pointer}/acceptedOrders/${orderIndex}/${tokenIndex}`, 'invalid-answer', `accepted token ${JSON.stringify(token)} is absent from tokens`));
      });
    });
  }
  if (record.rubric && record.rubric.minimumMet > record.rubric.criteria.length) {
    diagnostics.push(diagnostic(file, `${pointer}/rubric/minimumMet`, 'invalid-rubric', 'cannot exceed the number of rubric criteria'));
  }
}

function checkPublication(publication, course, diagnostics) {
  if (publication.record.courseVersion !== course.record.version) {
    diagnostics.push(diagnostic(publication.file, '/courseVersion', 'version-mismatch', `must equal course version ${JSON.stringify(course.record.version)}`));
  }
  for (const schemaName of [
    'course',
    'languageProfile',
    'capabilities',
    'modules',
    'mission',
    'lesson',
    'activity',
    'scenario',
    'pronunciationTargets',
    'publication',
  ]) {
    if (publication.record.schemaVersions[schemaName] === 1) continue;
    diagnostics.push(diagnostic(publication.file, `/schemaVersions/${schemaName}`, 'schema-version-mismatch', 'must declare schema version 1'));
  }
  if (publication.record.status === 'draft') return;
  if (!publication.record.publishedAt) {
    diagnostics.push(diagnostic(publication.file, '/publishedAt', 'publication-gate', 'a published or retired record requires publishedAt'));
  }
  if (publication.record.validatorReport.status !== 'passed') {
    diagnostics.push(diagnostic(publication.file, '/validatorReport/status', 'publication-gate', 'a published or retired record requires a passed validator report'));
  }
  for (const [name, review] of Object.entries(publication.record.reviews)) {
    if (review.status === 'approved') continue;
    diagnostics.push(diagnostic(publication.file, `/reviews/${name}/status`, 'publication-gate', 'a published or retired record requires every review to be approved'));
  }
  if (publication.record.status === 'retired' && !publication.record.retiredAt) {
    diagnostics.push(diagnostic(publication.file, '/retiredAt', 'publication-gate', 'a retired record requires retiredAt'));
  }
}

async function validateRelationships(loaded) {
  const locations = locationsFor(loaded);
  const realPackageRoot = await realpath(loaded.packageDirectory);
  const courseId = locations.course.record.id;
  const capabilityMap = byId(locations.capabilities);
  const moduleMap = byId(locations.modules);
  const missionMap = byId(locations.missions);
  const lessonMap = byId(locations.lessons);
  const activityMap = byId(locations.activities);
  const scenarioMap = byId(locations.scenarios);
  const pronunciationMap = byId(locations.pronunciationTargets);
  const publicationMap = new Map([[locations.publication.record.id, locations.publication]]);
  const clipMap = byId(locations.audioClips);

  for (const location of [
    locations.languageProfile,
    ...locations.capabilities,
    ...locations.modules,
    ...locations.missions,
    ...locations.scenarios,
    ...locations.pronunciationTargets,
    locations.publication,
  ]) checkCourseId(location, courseId, loaded.diagnostics);

  checkReferences(locations.course.record.exitCapabilityIds, capabilityMap, locations.course, '/exitCapabilityIds', 'capability', loaded.diagnostics);
  checkReferences(locations.course.record.placementPolicy.entryCapabilityIds, capabilityMap, locations.course, '/placementPolicy/entryCapabilityIds', 'capability', loaded.diagnostics);
  checkOrder(locations.course.record.moduleOrder, moduleMap, locations.course, '/moduleOrder', 'module', loaded.diagnostics);
  checkReference(locations.course.record.publicationRef, publicationMap, locations.course, '/publicationRef', 'publication', loaded.diagnostics);

  const stageIds = new Set(locations.course.record.stageOrder);
  for (const module of locations.modules) {
    checkReferences(module.record.targetCapabilityIds, capabilityMap, module, '/targetCapabilityIds', 'capability', loaded.diagnostics);
    checkReferences(module.record.supportingCapabilityIds, capabilityMap, module, '/supportingCapabilityIds', 'capability', loaded.diagnostics);
    checkReferences(module.record.prerequisiteModuleIds, moduleMap, module, '/prerequisiteModuleIds', 'module', loaded.diagnostics);
    checkReferences(module.record.missionIds, missionMap, module, '/missionIds', 'mission', loaded.diagnostics);
    checkReferences(module.record.delayedReviewCapabilityIds, capabilityMap, module, '/delayedReviewCapabilityIds', 'capability', loaded.diagnostics);
    checkReferences(module.record.recommendedScenarioIds, scenarioMap, module, '/recommendedScenarioIds', 'scenario', loaded.diagnostics);
    checkReference(module.record.checkpointActivityId, activityMap, module, '/checkpointActivityId', 'activity', loaded.diagnostics);
    module.record.missionIds.forEach((id, index) => {
      const mission = missionMap.get(id);
      if (!mission || mission.record.moduleId === module.record.id) return;
      loaded.diagnostics.push(diagnostic(module.file, `${module.pointer}/missionIds/${index}`, 'module-mismatch', `mission ${JSON.stringify(id)} belongs to module ${JSON.stringify(mission.record.moduleId)}`));
    });
    for (const mission of locations.missions.filter((item) => item.record.moduleId === module.record.id)) {
      if (module.record.missionIds.includes(mission.record.id)) continue;
      loaded.diagnostics.push(diagnostic(module.file, `${module.pointer}/missionIds`, 'missing-order-entry', `mission ${JSON.stringify(mission.record.id)} is not included in this module`));
    }
    const checkpoint = activityMap.get(module.record.checkpointActivityId);
    if (checkpoint && checkpoint.mission.record.moduleId !== module.record.id) {
      loaded.diagnostics.push(diagnostic(module.file, `${module.pointer}/checkpointActivityId`, 'module-mismatch', `checkpoint activity belongs to module ${JSON.stringify(checkpoint.mission.record.moduleId)}`));
    }
    module.record.recommendedScenarioIds.forEach((id, index) => {
      const scenario = scenarioMap.get(id);
      if (!scenario || scenario.record.moduleId === module.record.id) return;
      loaded.diagnostics.push(diagnostic(module.file, `${module.pointer}/recommendedScenarioIds/${index}`, 'module-mismatch', `scenario ${JSON.stringify(id)} belongs to module ${JSON.stringify(scenario.record.moduleId)}`));
    });
    if (!stageIds.has(module.record.stageId)) {
      loaded.diagnostics.push(diagnostic(module.file, `${module.pointer}/stageId`, 'missing-reference', `stage ${JSON.stringify(module.record.stageId)} is absent from course.stageOrder`));
    }
  }

  for (const capability of locations.capabilities) {
    checkReferences(capability.record.prerequisiteCapabilityIds, capabilityMap, capability, '/prerequisiteCapabilityIds', 'capability', loaded.diagnostics);
    checkReferences(capability.record.teachingMissionIds, missionMap, capability, '/teachingMissionIds', 'mission', loaded.diagnostics);
    capability.record.teachingMissionIds.forEach((id, index) => {
      const mission = missionMap.get(id);
      if (!mission || mission.record.targetCapabilityIds.includes(capability.record.id)) return;
      loaded.diagnostics.push(diagnostic(capability.file, `${capability.pointer}/teachingMissionIds/${index}`, 'capability-mismatch', `mission ${JSON.stringify(id)} does not target capability ${JSON.stringify(capability.record.id)}`));
    });
  }

  for (const mission of locations.missions) {
    const missionActivities = new Map(
      locations.activities.filter((activity) => activity.mission === mission).map((activity) => [activity.record.id, activity]),
    );
    checkReference(mission.record.moduleId, moduleMap, mission, '/moduleId', 'module', loaded.diagnostics);
    checkReferences(mission.record.targetCapabilityIds, capabilityMap, mission, '/targetCapabilityIds', 'capability', loaded.diagnostics);
    checkReferences(mission.record.supportingCapabilityIds, capabilityMap, mission, '/supportingCapabilityIds', 'capability', loaded.diagnostics);
    checkReferences(mission.record.prerequisiteCapabilityIds, capabilityMap, mission, '/prerequisiteCapabilityIds', 'capability', loaded.diagnostics);
    checkOrder(mission.record.lessonOrder, new Map(locations.lessons.filter((lesson) => lesson.mission === mission).map((lesson) => [lesson.record.id, lesson])), mission, '/lessonOrder', 'lesson', loaded.diagnostics);
    checkReferences(mission.record.completionCondition.requiredActivityIds, missionActivities, mission, '/completionCondition/requiredActivityIds', 'activity in this mission', loaded.diagnostics);
    checkReferences(mission.record.checkpointActivityIds, missionActivities, mission, '/checkpointActivityIds', 'activity in this mission', loaded.diagnostics);
    checkReferences(mission.record.reviewActivityIds, missionActivities, mission, '/reviewActivityIds', 'activity in this mission', loaded.diagnostics);
    checkReferences(mission.record.offline.unavailableActivityIds, missionActivities, mission, '/offline/unavailableActivityIds', 'activity in this mission', loaded.diagnostics);

    if (locations.publication.record.status !== 'draft') {
      const phases = new Set(locations.activities.filter((activity) => activity.mission === mission).map((activity) => activity.record.phase));
      for (const phase of ['encounter', 'notice', 'retrieve', 'produce', 'perform', 'revisit']) {
        if (phases.has(phase)) continue;
        loaded.diagnostics.push(diagnostic(mission.file, '/lessons', 'missing-phase', `mission does not cover the ${phase} phase`));
      }
    }

    const reviewIds = new Set(mission.record.reviewActivityIds);
    mission.record.checkpointActivityIds.forEach((id) => {
      if (!reviewIds.has(id)) return;
      const index = mission.record.reviewActivityIds.indexOf(id);
      loaded.diagnostics.push(diagnostic(mission.file, `/reviewActivityIds/${index}`, 'assessment-leak', `checkpoint activity ${JSON.stringify(id)} is reused in the review pool`));
    });
    mission.record.checkpointActivityIds.forEach((id, index) => {
      const activity = missionActivities.get(id);
      if (!activity || activity.record.usage === 'assessment') return;
      loaded.diagnostics.push(diagnostic(mission.file, `/checkpointActivityIds/${index}`, 'assessment-pool', `activity ${JSON.stringify(id)} must have assessment usage`));
    });
    mission.record.reviewActivityIds.forEach((id, index) => {
      const activity = missionActivities.get(id);
      if (!activity || activity.record.usage === 'review') return;
      loaded.diagnostics.push(diagnostic(mission.file, `/reviewActivityIds/${index}`, 'review-pool', `activity ${JSON.stringify(id)} must have review usage`));
    });

    const practiceActivities = [...missionActivities.values()].filter(({ record }) =>
      ['teaching', 'practice'].includes(record.usage));
    const freshReviewExposures = [...missionActivities.values()].filter(({ record }) =>
      record.usage !== 'review');
    const assessmentSignature = (record) => {
      const choices = record.choices ?? [];
      const choiceTextById = new Map(choices.map((choice) => [choice.id, choice.text]));
      const sortedStrings = (values) => values ? [...values].sort() : values;
      const sortedRecords = (values) => values
        ? [...values].sort((left, right) => {
          const leftKey = JSON.stringify(left);
          const rightKey = JSON.stringify(right);
          return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
        })
        : values;
      return JSON.stringify({
        rendererType: record.rendererType,
        prompt: record.prompt,
        text: record.text,
        audioId: record.audioId,
        choiceTexts: sortedStrings(choices.map((choice) => choice.text)),
        acceptedChoiceTexts: sortedStrings(record.acceptedChoiceIds?.map((id) => choiceTextById.get(id))),
        pairs: sortedRecords(record.pairs),
        tokens: sortedStrings(record.tokens),
        acceptedOrders: sortedRecords(record.acceptedOrders),
        acceptedResponses: sortedStrings(record.acceptedResponses),
        pronunciationTargetId: record.pronunciationTargetId,
        scenarioId: record.scenarioId,
        rubric: record.rubric ? {
          criteria: sortedStrings(record.rubric.criteria),
          minimumMet: record.rubric.minimumMet,
        } : undefined,
        assetIds: sortedStrings(record.assetIds),
      });
    };
    const practiceSignatures = new Map(practiceActivities.map((activity) => [assessmentSignature(activity.record), activity]));
    const reviewExposureSignatures = new Map(freshReviewExposures.map((activity) => [assessmentSignature(activity.record), activity]));
    mission.record.checkpointActivityIds.forEach((id, index) => {
      const checkpointActivity = missionActivities.get(id);
      if (!checkpointActivity) return;
      const leakedFrom = practiceSignatures.get(assessmentSignature(checkpointActivity.record));
      if (!leakedFrom) return;
      loaded.diagnostics.push(diagnostic(mission.file, `/checkpointActivityIds/${index}`, 'assessment-leak', `checkpoint activity duplicates practice content from ${JSON.stringify(leakedFrom.record.id)}`));
    });
    mission.record.reviewActivityIds.forEach((id, index) => {
      const reviewActivity = missionActivities.get(id);
      if (!reviewActivity) return;
      const leakedFrom = reviewExposureSignatures.get(assessmentSignature(reviewActivity.record));
      if (!leakedFrom) return;
      loaded.diagnostics.push(diagnostic(mission.file, `/reviewActivityIds/${index}`, 'assessment-leak', `review activity duplicates previously exposed content from ${JSON.stringify(leakedFrom.record.id)}`));
    });

    const assetMap = new Map();
    for (const [index, asset] of mission.record.assets.entries()) {
      if (assetMap.has(asset.id)) {
        loaded.diagnostics.push(diagnostic(mission.file, `/assets/${index}/id`, 'duplicate-id', `asset ID ${JSON.stringify(asset.id)} is duplicated in this mission`));
      } else assetMap.set(asset.id, { record: asset, file: mission.file, pointer: `/assets/${index}` });
      const absoluteAssetPath = path.resolve(loaded.packageDirectory, asset.path);
      const packagePrefix = `${path.resolve(loaded.packageDirectory)}${path.sep}`;
      let assetExists = false;
      if (absoluteAssetPath.startsWith(packagePrefix)) {
        try {
          const relativeAssetPath = path.relative(loaded.packageDirectory, absoluteAssetPath);
          const expectedRealPath = path.resolve(realPackageRoot, relativeAssetPath);
          const realAssetPath = await realpath(absoluteAssetPath);
          assetExists = realAssetPath === expectedRealPath && (await lstat(realAssetPath)).isFile();
        } catch {
          assetExists = false;
        }
      }
      if (!assetExists) loaded.diagnostics.push(diagnostic(mission.file, `/assets/${index}/path`, 'missing-asset', `asset path ${JSON.stringify(asset.path)} does not exist as a file in the package`));
    }
    for (const lesson of locations.lessons.filter((item) => item.mission === mission)) {
      checkReferences(lesson.record.assetIds, assetMap, lesson, '/assetIds', 'asset', loaded.diagnostics);
      for (const activity of locations.activities.filter((item) => item.lesson === lesson)) {
        checkReferences(activity.record.assetIds, assetMap, activity, '/assetIds', 'asset', loaded.diagnostics);
      }
    }
  }

  for (const lesson of locations.lessons) {
    if (lesson.record.missionId !== lesson.mission.record.id) {
      loaded.diagnostics.push(diagnostic(lesson.file, `${lesson.pointer}/missionId`, 'mission-mismatch', `must reference containing mission ${JSON.stringify(lesson.mission.record.id)}`));
    }
    const localActivities = new Map(locations.activities.filter((activity) => activity.lesson === lesson).map((activity) => [activity.record.id, activity]));
    checkReferences(lesson.record.completionCondition.requiredActivityIds, localActivities, lesson, '/completionCondition/requiredActivityIds', 'activity', loaded.diagnostics);
    checkReferences(lesson.record.safeResumeActivityIds, localActivities, lesson, '/safeResumeActivityIds', 'activity', loaded.diagnostics);
  }

  for (const activity of locations.activities) {
    checkReferences(activity.record.targetCapabilityIds, capabilityMap, activity, '/targetCapabilityIds', 'capability', loaded.diagnostics);
    checkReferences(activity.record.supportingCapabilityIds, capabilityMap, activity, '/supportingCapabilityIds', 'capability', loaded.diagnostics);
    if (activity.record.audioId) checkReference(activity.record.audioId, clipMap, activity, '/audioId', 'audio clip', loaded.diagnostics);
    if (activity.record.scenarioId) checkReference(activity.record.scenarioId, scenarioMap, activity, '/scenarioId', 'scenario', loaded.diagnostics);
    if (activity.record.pronunciationTargetId) checkReference(activity.record.pronunciationTargetId, pronunciationMap, activity, '/pronunciationTargetId', 'pronunciation target', loaded.diagnostics);
    checkActivityAnswerContract(activity, loaded.diagnostics);
    if (activity.record.rendererType === 'listen_repeat' && activity.record.assessmentEligible) {
      const target = pronunciationMap.get(activity.record.pronunciationTargetId);
      if (target && !target.record.assessmentEligibility.eligible) {
        loaded.diagnostics.push(diagnostic(activity.file, `${activity.pointer}/assessmentEligible`, 'ineligible-pronunciation-assessment', `pronunciation target ${JSON.stringify(target.record.id)} has no eligible evaluator`));
      }
    }
    if (activity.record.scenarioId) {
      const scenario = scenarioMap.get(activity.record.scenarioId);
      if (scenario && scenario.record.moduleId !== activity.mission.record.moduleId) {
        loaded.diagnostics.push(diagnostic(activity.file, `${activity.pointer}/scenarioId`, 'module-mismatch', `scenario belongs to module ${JSON.stringify(scenario.record.moduleId)}`));
      }
    }
  }

  for (const scenario of locations.scenarios) {
    checkReference(scenario.record.moduleId, moduleMap, scenario, '/moduleId', 'module', loaded.diagnostics);
    checkReferences(scenario.record.targetCapabilityIds, capabilityMap, scenario, '/targetCapabilityIds', 'capability', loaded.diagnostics);
    checkReferences(scenario.record.supportingCapabilityIds, capabilityMap, scenario, '/supportingCapabilityIds', 'capability', loaded.diagnostics);
    const observations = new Map();
    scenario.record.successObservations.forEach((record, index) => {
      if (observations.has(record.id)) {
        loaded.diagnostics.push(diagnostic(scenario.file, `/successObservations/${index}/id`, 'duplicate-id', `success observation ID ${JSON.stringify(record.id)} is duplicated in this scenario`));
      } else observations.set(record.id, { record, file: scenario.file, pointer: `/successObservations/${index}` });
    });
    checkReferences(scenario.record.completionRule.requiredObservationIds, observations, scenario, '/completionRule/requiredObservationIds', 'success observation', loaded.diagnostics);
    scenario.record.evidenceMapping.forEach((mapping, index) => {
      checkReference(mapping.observationId, observations, scenario, `/evidenceMapping/${index}/observationId`, 'success observation', loaded.diagnostics);
      checkReference(mapping.capabilityId, capabilityMap, scenario, `/evidenceMapping/${index}/capabilityId`, 'capability', loaded.diagnostics);
    });
    if (scenario.record.targetTurnRange.minimum > scenario.record.targetTurnRange.maximum) {
      loaded.diagnostics.push(diagnostic(scenario.file, '/targetTurnRange/minimum', 'invalid-range', 'must not exceed targetTurnRange.maximum'));
    }
  }

  for (const target of locations.pronunciationTargets) {
    checkReferences(target.record.targetAudioIds, clipMap, target, '/targetAudioIds', 'audio clip', loaded.diagnostics);
    if (target.record.locale !== locations.course.record.targetLocale) {
      loaded.diagnostics.push(diagnostic(target.file, `${target.pointer}/locale`, 'locale-mismatch', `must equal course target locale ${JSON.stringify(locations.course.record.targetLocale)}`));
    }
    if (target.record.targetVariety !== locations.course.record.targetVariety) {
      loaded.diagnostics.push(diagnostic(target.file, `${target.pointer}/targetVariety`, 'variety-mismatch', `must equal course target variety ${JSON.stringify(locations.course.record.targetVariety)}`));
    }
  }

  for (const [index, clip] of loaded.audioManifest.data.clips.entries()) {
    if (!lessonMap.has(clip.lessonId)) {
      loaded.diagnostics.push(diagnostic(loaded.audioManifest.file, `/clips/${index}/lessonId`, 'missing-reference', `lesson ${JSON.stringify(clip.lessonId)} does not exist`));
    }
  }

  for (const capability of locations.capabilities) {
    for (const [ruleName, eligibility, label] of [
      ['practiceEvidence', 'practice', 'practice'],
      ['demonstrationCriteria', 'demonstration', 'demonstration'],
      ['retentionCriteria', 'retention', 'retention'],
    ]) {
      const actual = locations.activities.filter(({ record }) =>
        record.evidenceEligibility === eligibility
        && record.targetCapabilityIds.includes(capability.record.id)).length;
      const minimum = capability.record[ruleName].minimumOpportunities;
      if (actual < minimum) {
        loaded.diagnostics.push(diagnostic(
          capability.file,
          `${capability.pointer}/${ruleName}/minimumOpportunities`,
          'insufficient-opportunities',
          `declares ${minimum} ${label} opportunities but only ${actual} are authored`,
        ));
      }
    }
  }

  findCycles(locations.capabilities, (record) => record.prerequisiteCapabilityIds, 'prerequisiteCapabilityIds', loaded.diagnostics);
  findCycles(locations.modules, (record) => record.prerequisiteModuleIds, 'prerequisiteModuleIds', loaded.diagnostics);
  checkCapabilityReachability(locations.course, locations.capabilities, loaded.diagnostics);
  checkPublication(locations.publication, locations.course, loaded.diagnostics);

  for (const mission of locations.missions) {
    const expectedName = `${mission.record.id}.json`;
    if (path.basename(mission.file) !== expectedName) loaded.diagnostics.push(diagnostic(mission.file, '/id', 'filename-mismatch', `mission file must be named ${expectedName}`));
  }
  for (const scenario of locations.scenarios) {
    const expectedName = `${scenario.record.id}.json`;
    if (path.basename(scenario.file) !== expectedName) loaded.diagnostics.push(diagnostic(scenario.file, '/id', 'filename-mismatch', `scenario file must be named ${expectedName}`));
  }

  return locations;
}

async function listPackageFiles(directory, current = '') {
  const entries = await readdir(path.join(directory, current), { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const relative = path.join(current, entry.name);
    if (entry.isDirectory()) files.push(...await listPackageFiles(directory, relative));
    else if (entry.isFile() && slash(relative) !== 'publication.json') files.push(relative);
  }
  return files;
}

export async function computeContentHash(packageDirectory) {
  const hash = createHash('sha256');
  for (const relative of await listPackageFiles(packageDirectory)) {
    hash.update(slash(relative));
    hash.update('\0');
    hash.update(await readFile(path.join(packageDirectory, relative)));
    hash.update('\0');
  }
  return `sha256:${hash.digest('hex')}`;
}

export async function validateCoursePackage(packageDirectory, { root = workspaceRoot } = {}) {
  const resolvedPackageDirectory = path.resolve(packageDirectory);
  const loaded = await loadPackage(resolvedPackageDirectory, root);
  if (loaded.diagnostics.length === 0) validateSchemas(loaded, await getSchemaValidators());
  let locations;
  if (loaded.diagnostics.length === 0) locations = await validateRelationships(loaded);
  if (loaded.diagnostics.length === 0) {
    const actualHash = await computeContentHash(resolvedPackageDirectory);
    if (loaded.publication.data.contentHash !== actualHash) {
      loaded.diagnostics.push(diagnostic(loaded.publication.file, '/contentHash', 'content-hash', `must equal deterministic package hash ${actualHash}`));
    }
  }
  return {
    packageDirectory: resolvedPackageDirectory,
    diagnostics: sortDiagnostics(loaded.diagnostics),
    stats: locations ? {
      capabilities: locations.capabilities.length,
      modules: locations.modules.length,
      missions: locations.missions.length,
      lessons: locations.lessons.length,
      activities: locations.activities.length,
      scenarios: locations.scenarios.length,
      pronunciationTargets: locations.pronunciationTargets.length,
    } : null,
  };
}

export function formatDiagnostic(item) {
  return `${item.file}:${item.pointer} [${item.code}] ${item.message}`;
}

export async function discoverCoursePackages(root = workspaceRoot) {
  const packageDirectories = [];
  const skippedLegacyDirectories = [];
  const coursesDirectory = path.join(root, 'content', 'courses');
  for (const entry of (await readdir(coursesDirectory, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory()) continue;
    const directory = path.join(coursesDirectory, entry.name);
    if (await exists(path.join(directory, 'course.json'))) packageDirectories.push(directory);
    else skippedLegacyDirectories.push(directory);
  }
  const validFixturesDirectory = path.join(root, 'content', 'fixtures', 'course-content', 'valid');
  for (const entry of (await readdir(validFixturesDirectory, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.isDirectory()) packageDirectories.push(path.join(validFixturesDirectory, entry.name));
  }
  return { packageDirectories, skippedLegacyDirectories };
}
