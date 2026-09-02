#!/usr/bin/env node
import path from 'node:path';
import process from 'node:process';

import {
  discoverCoursePackages,
  formatDiagnostic,
  validateCoursePackage,
  workspaceRoot,
} from './validator.mjs';

async function main() {
  const argumentsToRead = process.argv.slice(2);
  if (argumentsToRead.includes('--help')) {
    console.log('Usage: npm run course:validate -- [course-package-directory ...]');
    return;
  }
  if (argumentsToRead.some((argument) => argument.startsWith('-'))) {
    throw new Error(`Unknown argument: ${argumentsToRead.find((argument) => argument.startsWith('-'))}`);
  }

  let packageDirectories;
  let skippedLegacyDirectories = [];
  if (argumentsToRead.length) {
    packageDirectories = argumentsToRead.map((argument) => path.resolve(workspaceRoot, argument));
  } else {
    ({ packageDirectories, skippedLegacyDirectories } = await discoverCoursePackages(workspaceRoot));
  }
  if (packageDirectories.length === 0) throw new Error('No schema-based course packages were found.');

  const results = [];
  for (const directory of packageDirectories) results.push(await validateCoursePackage(directory));
  const diagnostics = results.flatMap((result) => result.diagnostics);
  if (diagnostics.length) {
    for (const item of diagnostics) console.error(formatDiagnostic(item));
    throw new Error(`Course validation failed with ${diagnostics.length} diagnostic${diagnostics.length === 1 ? '' : 's'}.`);
  }

  const totals = results.reduce((sum, result) => {
    for (const [name, value] of Object.entries(result.stats)) sum[name] = (sum[name] ?? 0) + value;
    return sum;
  }, {});
  console.log(
    `Validated ${results.length} course package${results.length === 1 ? '' : 's'}: `
    + `${totals.capabilities} capabilities, ${totals.modules} modules, ${totals.missions} missions, `
    + `${totals.lessons} lessons, ${totals.activities} activities, ${totals.scenarios} scenarios, `
    + `${totals.pronunciationTargets} pronunciation targets.`,
  );
  for (const directory of skippedLegacyDirectories) {
    console.log(`Legacy package preserved (no course.json yet): ${path.relative(workspaceRoot, directory).split(path.sep).join('/')}`);
  }
  console.log('Validation used repository files only; no network or provider credentials were required.');
}

main().catch((error) => {
  console.error(`Course validation failed: ${error.message}`);
  process.exitCode = 1;
});
