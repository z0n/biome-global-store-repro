import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = join(root, '.repro');
const store = join(output, 'pnpm-store');
const rule = 'lint/nursery/noUselessTypeConversion';

function pnpm(args, cwd) {
  const result = spawnSync('pnpm', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
  if (result.error) throw result.error;
  assert.equal(result.signal, null, 'pnpm was terminated by a signal');
  return result;
}

async function check(storeType) {
  const project = join(output, `${storeType}-store`);
  await cp(join(root, 'fixtures/project'), project, { recursive: true });
  const workspacePath = join(project, 'pnpm-workspace.yaml');
  const workspace = await readFile(workspacePath, 'utf8');
  await writeFile(workspacePath, workspace.replace(
    'virtualStoreType: project', `virtualStoreType: ${storeType}`,
  ));

  console.log(`\nInstalling with virtualStoreType: ${storeType}`);
  const install = pnpm([
    'install', '--frozen-lockfile', '--ignore-scripts', '--store-dir', store,
  ], project);
  await writeFile(join(project, 'install.log'), install.stdout + install.stderr);
  assert.equal(install.status, 0, `Install failed:\n${install.stdout}\n${install.stderr}`);

  const version = pnpm(['exec', 'biome', '--version'], project);
  assert.equal(version.status, 0, version.stderr);
  console.log(version.stdout.trim());

  const target = await realpath(join(project, 'node_modules', '@types', 'react'));
  const relativeTarget = relative(project, target);
  const outside = relativeTarget.startsWith('..') || isAbsolute(relativeTarget);
  assert.equal(outside, storeType === 'global', `Unexpected pnpm layout: ${target}`);
  console.log(`  @types/react target: ${relative(root, target)}`);

  const result = pnpm([
    'exec', 'biome', 'lint', '--only=nursery/noUselessTypeConversion',
    '--reporter=json', 'example.ts',
  ], project);
  await writeFile(join(project, 'diagnostics.json'), result.stdout);
  await writeFile(join(project, 'stderr.txt'), result.stderr);
  assert.equal(result.status, 1, `Expected lint errors, got ${result.status}\n${result.stderr}`);
  const report = JSON.parse(result.stdout);
  assert.ok(Array.isArray(report.diagnostics), 'Missing Biome diagnostics');
  assert.ok(report.diagnostics.every((d) => d.category === rule), 'Unexpected diagnostic');

  const lines = report.diagnostics.map((d) => d.location.start.line).sort((a, b) => a - b);
  assert.ok(lines.includes(7), 'Literal-string control was not detected');
  assert.ok(!lines.includes(8), 'Necessary number conversion was flagged');
  assert.ok(lines.every((line) => line === 6 || line === 7), 'Unexpected diagnostic location');
  console.log(`${storeType}-store: redundant-conversion diagnostics on lines ${lines.join(', ')}`);
  return lines;
}

const version = pnpm(['--version'], root);
assert.equal(version.status, 0, version.stderr);
assert.equal(version.stdout.trim(), '12.17.0', 'Use the pinned pnpm 12.17.0 version');
console.log(`pnpm ${version.stdout.trim()}; Node ${process.version}; ${process.platform}/${process.arch}`);
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
const project = await check('project');
const global = await check('global');
assert.deepEqual(project, [6, 7], 'Project-store baseline did not detect both violations');

if (global.includes(6)) {
  assert.deepEqual(global, project);
  console.log('\nPASS: both layouts detect the same violations. Bug not reproduced.');
} else {
  console.error('\nBUG REPRODUCED: global-store dependency types silently lose a diagnostic.');
  console.error('Expected lines 6 and 7 in both layouts; global-store only reports line 7.');
  process.exitCode = 1;
}
console.log('Install logs, JSON reports, and runnable projects are in .repro/.');
