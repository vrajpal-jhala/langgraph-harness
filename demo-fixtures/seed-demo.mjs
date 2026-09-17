#!/usr/bin/env node
// Seeds a personal GitLab project with the demo todo app so langgraph-harness has
// something real to review and resolve issues against for product screenshots.
// Every step only creates what's missing, so re-running is safe — it never touches
// an MR or issue that may already carry real review comments or replies.
// Pass --reset to delete the project and start over from nothing.
//
// Required env: GITLAB_TOKEN (personal access token, api scope), GITLAB_NAMESPACE
// (your username, or a group path you own). Optional: GITLAB_HOST, GITLAB_PROJECT.

import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));

const GITLAB_HOST = process.env.GITLAB_HOST || 'gitlab.com';
const TOKEN = process.env.GITLAB_TOKEN;
const NAMESPACE = process.env.GITLAB_NAMESPACE;
const PROJECT_NAME = process.env.GITLAB_PROJECT || 'langgraph-harness-demo';
const RESET = process.argv.includes('--reset');

if (!TOKEN || !NAMESPACE) {
  console.error('Set GITLAB_TOKEN (personal access token, api scope) and GITLAB_NAMESPACE (your username or a group path you own).');
  process.exit(1);
}

const API = `https://${GITLAB_HOST}/api/v4`;
const PROJECT_PATH = `${NAMESPACE}/${PROJECT_NAME}`;

async function api(path, opts = {}) {
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: { 'PRIVATE-TOKEN': TOKEN, 'Content-Type': 'application/json', ...opts.headers },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${opts.method || 'GET'} ${path} -> ${res.status}: ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

function git(args, cwd) {
  execFileSync('git', args, { cwd, stdio: 'inherit' });
}

function remoteUrl() {
  return `https://oauth2:${TOKEN}@${GITLAB_HOST}/${PROJECT_PATH}.git`;
}

function scratchDir() {
  return mkdtempSync(join(tmpdir(), 'seed-demo-'));
}

async function findProject() {
  return api(`/projects/${encodeURIComponent(PROJECT_PATH)}`);
}

async function createProject() {
  console.log(`Creating project ${PROJECT_PATH}...`);
  const group = await api(`/groups/${encodeURIComponent(NAMESPACE)}`);
  return api('/projects', {
    method: 'POST',
    body: JSON.stringify({
      name: PROJECT_NAME,
      path: PROJECT_NAME,
      namespace_id: group ? group.id : undefined,
      default_branch: 'main',
      visibility: 'public',
    }),
  });
}

async function deleteProject(project) {
  console.log(`Deleting ${PROJECT_PATH} (--reset)...`);
  await api(`/projects/${project.id}`, { method: 'DELETE' });
}

async function branchExists(project, branch) {
  return api(`/projects/${project.id}/repository/branches/${encodeURIComponent(branch)}`);
}

function pushBaseline() {
  const scratch = scratchDir();
  cpSync(join(HERE, 'todo-app'), scratch, { recursive: true });
  git(['init', '-b', 'main'], scratch);
  git(['add', '.'], scratch);
  git(['commit', '-m', 'Initial commit'], scratch);
  git(['remote', 'add', 'origin', remoteUrl()], scratch);
  git(['push', '-u', 'origin', 'main'], scratch);
  rmSync(scratch, { recursive: true, force: true });
}

function pushFeatureBranch(branch, overlayDir, commitMessage) {
  const scratch = scratchDir();
  git(['clone', remoteUrl(), scratch]);
  git(['checkout', '-b', branch, 'origin/main'], scratch);
  cpSync(overlayDir, scratch, { recursive: true });
  git(['add', '-A'], scratch);
  git(['commit', '-m', commitMessage], scratch);
  git(['push', '-u', 'origin', branch], scratch);
  rmSync(scratch, { recursive: true, force: true });
}

async function ensureBaseline(project) {
  if (await branchExists(project, 'main')) {
    console.log('main already pushed, skipping.');
    return;
  }
  console.log('Pushing baseline todo app...');
  pushBaseline();
}

async function ensureFeatureBranch(project) {
  const branch = 'feat/due-today-filter';
  if (await branchExists(project, branch)) {
    console.log(`${branch} already exists, skipping.`);
    return branch;
  }
  console.log(`Pushing ${branch}...`);
  pushFeatureBranch(branch, join(HERE, 'feature-due-today'), 'Add a due-today filter to the todo list');
  return branch;
}

async function ensureMergeRequest(project, sourceBranch) {
  const open = await api(
    `/projects/${project.id}/merge_requests?source_branch=${encodeURIComponent(sourceBranch)}&state=opened`
  );
  if (open && open.length) {
    console.log('MR already open, skipping.');
    return;
  }
  console.log('Opening MR...');
  await api(`/projects/${project.id}/merge_requests`, {
    method: 'POST',
    body: JSON.stringify({
      source_branch: sourceBranch,
      target_branch: 'main',
      title: 'Add a due-today filter to the todo list',
      description: 'Adds `GET /todos/due-today` so the UI can highlight what needs doing today.',
    }),
  });
}

async function ensureIssue(project) {
  const title = 'Add a completed-count badge to GET /todos';
  const found = await api(`/projects/${project.id}/issues?search=${encodeURIComponent(title)}`);
  if (found && found.length) {
    console.log('Issue already exists, skipping.');
    return;
  }
  console.log('Creating issue...');
  await api(`/projects/${project.id}/issues`, {
    method: 'POST',
    body: JSON.stringify({
      title,
      description:
        'Add a `completedCount` field to the `GET /todos` response so clients can show progress without counting client-side.',
    }),
  });
}

async function main() {
  let project = await findProject();
  if (RESET && project) {
    await deleteProject(project);
    project = null;
  }
  if (!project) project = await createProject();

  await ensureBaseline(project);
  const branch = await ensureFeatureBranch(project);
  await ensureMergeRequest(project, branch);
  await ensureIssue(project);

  console.log(`\nDone: https://${GITLAB_HOST}/${PROJECT_PATH}`);
  console.log('Next: point a webhook at your tunneled dev backend, then assign the issue to your bot user.');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
