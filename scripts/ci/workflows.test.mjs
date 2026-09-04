import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const workflowRoot = path.join(projectRoot, '.github/workflows');

function readWorkflow(name) {
  return readFileSync(path.join(workflowRoot, name), 'utf8');
}

test('the operator-facing Actions surface contains exactly four workflows', () => {
  const workflows = readdirSync(workflowRoot)
    .filter((name) => /\.ya?ml$/.test(name))
    .sort();

  assert.deepEqual(workflows, [
    'deploy-development-api.yml',
    'deploy-production-api.yml',
    'desktop-release.yml',
    'verify.yml',
  ]);
});

test('CI keeps every protected check and user-facing verification in one workflow', () => {
  const workflow = readWorkflow('verify.yml');

  assert.match(workflow, /^name: CI$/m);
  assert.match(workflow, /^\s+name: Expo and Electron$/m);
  assert.match(workflow, /^\s+name: FastAPI and PostgreSQL$/m);
  assert.match(workflow, /^\s+name: Terraform$/m);
  assert.match(workflow, /^\s+name: Website production states$/m);
  assert.match(workflow, /^\s+name: Expo web and Electron functional$/m);
  assert.match(workflow, /^\s+client_gate:$/m);
  assert.match(workflow, /^\s+needs: \[client, website, functional\]$/m);
  assert.match(workflow, /test "\$\{WEBSITE_RESULT\}" = "success"/);
  assert.match(workflow, /test "\$\{FUNCTIONAL_RESULT\}" = "success"/);
  assert.match(workflow, /^\s+pull_request:$/m);
  assert.match(workflow, /^\s+push:$/m);
});

test('development deploy defaults to the API and keeps the tutor manual and disabled', () => {
  const workflow = readWorkflow('deploy-development-api.yml');

  assert.match(workflow, /^name: Deploy Development$/m);
  assert.match(workflow, /^\s+default: api$/m);
  assert.match(workflow, /^\s+- tutor$/m);
  assert.match(workflow, /github\.event_name == 'workflow_dispatch'.*inputs\.component == 'tutor'/);
  assert.match(workflow, /test "\$\{enabled\}" = "false"/);
  assert.doesNotMatch(workflow, /^\s+branches: \[main\][\s\S]*services\/lesson-tutor\/\*\*/m);
});

test('production API and desktop publication remain intentional release actions', () => {
  const api = readWorkflow('deploy-production-api.yml');
  const desktop = readWorkflow('desktop-release.yml');

  assert.match(api, /^\s+workflow_dispatch:$/m);
  assert.doesNotMatch(api, /^\s+push:$/m);
  assert.match(desktop, /^\s+workflow_dispatch:$/m);
  assert.match(desktop, /^\s+tags:$/m);
  assert.match(desktop, /^\s+- desktop-v\*$/m);
});
