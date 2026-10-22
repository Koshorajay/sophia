import { cp, copyFile, mkdir, mkdtemp, readFile, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export async function packageLambda(output = join(root, 'work', 'lambda.zip')) {
  const stage = await mkdtemp(join(tmpdir(), 'sophia-lambda-'));
  for (const name of ['lambda.mjs', 'src', 'public', 'package.json', 'package-lock.json']) {
    try {
      await cp(join(root, name), join(stage, name), { recursive: true });
    } catch (error) {
      if (error.code !== 'ENOENT' || name !== 'package-lock.json') throw error;
    }
  }
  try {
    await cp(join(root, 'data'), join(stage, 'data'), { recursive: true });
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const pkg = JSON.parse(await readFile(join(stage, 'package.json'), 'utf8'));
  for (const name of [
    '@aws-sdk/client-bedrock-runtime',
    '@aws-sdk/client-dynamodb',
    '@aws-sdk/lib-dynamodb',
    '@aws-sdk/client-polly',
    '@modelcontextprotocol/sdk',
  ]) {
    if (!pkg.dependencies?.[name])
      throw new Error(`Missing runtime dependency ${name}; install it in the project before packaging.`);
  }
  let hasLock = true;
  try {
    await stat(join(stage, 'package-lock.json'));
  } catch {
    hasLock = false;
  }
  const install = spawnSync(
    'npm',
    [hasLock ? 'ci' : 'install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'],
    { cwd: stage, stdio: 'inherit' },
  );
  if (install.status !== 0) throw new Error('Could not install Lambda production dependencies.');
  await mkdir(dirname(output), { recursive: true });
  // Always create a fresh archive so deleted source files cannot survive an incremental ZIP update.
  const temporaryZip = join(tmpdir(), `${basename(stage)}.zip`);
  const zip = spawnSync('zip', ['-q', '-r', temporaryZip, '.', '-x', '*.DS_Store'], { cwd: stage, stdio: 'inherit' });
  if (zip.status !== 0) throw new Error('ZIP packaging failed. Install the zip utility.');
  await copyFile(temporaryZip, resolve(output));
  console.log(`Lambda bundle: ${resolve(output)}`);
  console.log(`Temporary packaging directory: ${stage}`);
  return resolve(output);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  packageLambda(process.argv[2]).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
