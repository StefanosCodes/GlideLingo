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

test('the operator-facing Actions surface contains only CI/CD and desktop release', () => {
  const workflows = readdirSync(workflowRoot)
    .filter((name) => /\.ya?ml$/.test(name))
    .sort();

  assert.deepEqual(workflows, ['ci.yml', 'desktop-release.yml']);
});

test('CI/CD uses the same verification path for PRs and main, then deploys only after verification', () => {
  const workflow = readWorkflow('ci.yml');

  assert.match(workflow, /^name: CI\/CD$/m);
  assert.match(workflow, /^\s+pull_request:$/m);
  assert.match(workflow, /^\s+push:$/m);
  assert.match(workflow, /^\s+branches: \[main\]$/m);
  assert.match(workflow, /^\s+verify:$/m);
  assert.match(workflow, /^\s+name: Verify$/m);
  assert.match(workflow, /run: npm run verify/);
  assert.match(workflow, /run: npm run desktop:export/);
  assert.match(workflow, /run: npm run setup:backend && npm run api:verify/);
  assert.match(workflow, /run: npm run setup:tutor && npm run tutor:verify/);
  assert.match(workflow, /run: npm run check && npm test && npm run build/);
  assert.match(workflow, /^\s+deploy:$/m);
  assert.match(workflow, /^\s+name: Deploy API$/m);
  assert.match(workflow, /^\s+needs: verify$/m);
  assert.match(
    workflow,
    /if: \$\{\{ github\.event_name != 'pull_request' && github\.ref == 'refs\/heads\/main' \}\}/,
  );
});

test('production deploy keeps the essential cloud security and recovery primitives', () => {
  const workflow = readWorkflow('ci.yml');

  assert.match(workflow, /^\s+environment: production$/m);
  assert.match(workflow, /^\s+id-token: write$/m);
  assert.match(workflow, /google-github-actions\/auth@/);
  assert.match(workflow, /workload_identity_provider:/);
  assert.match(workflow, /service_account:/);
  assert.match(workflow, /:\$\{GITHUB_SHA\}/);
  assert.match(workflow, /gcloud run deploy/);
  assert.match(workflow, /\/health\/live/);
  assert.match(workflow, /\/health\/ready/);
});

test('desktop publication remains an explicit signed release path', () => {
  const desktop = readWorkflow('desktop-release.yml');

  assert.match(desktop, /^name: Desktop Release$/m);
  assert.match(desktop, /^\s+workflow_dispatch:$/m);
  assert.match(desktop, /^\s+tags:$/m);
  assert.match(desktop, /^\s+- desktop-v\*$/m);
  assert.match(desktop, /Sign, notarize, and stage macOS draft/);
});
