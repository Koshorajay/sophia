/** Interactive, opt-in AWS deployment. Never invoked by local start/test. */
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { packageLambda } from './package-aws.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const flags = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  if (!process.argv[i].startsWith('--') || !process.argv[i + 1])
    throw new Error(
      'Use --region REGION [--stack sophia-demo] [--model amazon.nova-micro-v1:0] [--daily-calls 200] [--profile NAME].',
    );
  flags.set(process.argv[i].slice(2), process.argv[i + 1]);
}
const region = flags.get('region');
const stack = flags.get('stack') || 'sophia-demo';
const model = flags.get('model') || 'amazon.nova-lite-v1:0';
// Third-party Bedrock models are billed through AWS Marketplace, which promotional credits may not cover.
if (!/^amazon\.[a-z0-9.:-]+$/.test(model))
  throw new Error('--model must be an Amazon model such as amazon.nova-lite-v1:0, so usage stays within AWS credits.');
const dailyCalls = Number(flags.get('daily-calls') || 200);
const concurrency = Number(flags.get('concurrency') || 2);
const voice = flags.get('voice') || 'polly';
if (!region || !/^[a-z]{2}(?:-[a-z]+)+-\d$/.test(region))
  throw new Error('Choose a supported AWS region explicitly with --region.');
if (!/^[a-z][a-z0-9-]{0,23}$/.test(stack))
  throw new Error('Use a lowercase stack name of 1–24 letters, numbers, or hyphens, starting with a letter.');
if (!Number.isInteger(dailyCalls) || dailyCalls < 1 || dailyCalls > 1000)
  throw new Error('--daily-calls must be 1..1000.');
if (!['polly', 'browser'].includes(voice)) throw new Error('--voice must be polly or browser.');
if (!Number.isInteger(concurrency) || concurrency < -1 || concurrency > 5)
  throw new Error('--concurrency must be -1..5 (-1 reserves none).');
const common = ['--region', region, '--no-cli-pager'];
if (flags.has('profile')) common.push('--profile', flags.get('profile'));

function aws(args, input, allowFailure = false) {
  // No shell expansion. Input JSON (which can hold the access code) goes in a private 0600 file that is
  // deleted straight after the call, never in process arguments. Node's child stdin is a socket, which
  // the AWS CLI cannot open as file:///dev/stdin.
  let dir;
  if (input !== undefined) {
    dir = mkdtempSync(join(tmpdir(), 'sophia-deploy-'));
    const file = join(dir, 'input.json');
    writeFileSync(file, JSON.stringify(input), { mode: 0o600 });
    args = args.map(arg => (arg === 'file:///dev/stdin' ? `file://${file}` : arg));
  }
  try {
    const result = spawnSync('aws', [...args, ...common], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
    if (result.error) throw new Error(`AWS CLI unavailable: ${result.error.message}`);
    if (result.status !== 0 && !allowFailure) throw new Error(result.stderr?.trim() || 'AWS operation failed.');
    return result;
  } finally {
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
}
function json(result) {
  return JSON.parse(result.stdout || '{}');
}
async function question(prompt) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question(prompt);
  } finally {
    rl.close();
  }
}
async function secret(prompt) {
  if (!process.stdin.isTTY || !process.stdin.setRawMode)
    throw new Error('Run from an interactive terminal to enter the demo access code privately.');
  process.stdout.write(prompt);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolveSecret, reject) => {
    let value = '';
    const cleanup = () => {
      process.stdin.off('data', onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write('\n');
    };
    const onData = buffer => {
      for (const ch of buffer.toString('utf8')) {
        if (ch === '\u0003') {
          cleanup();
          reject(new Error('Cancelled.'));
          return;
        }
        if (ch === '\r' || ch === '\n') {
          cleanup();
          resolveSecret(value);
          return;
        }
        if (ch === '\u007f' || ch === '\b') {
          value = value.slice(0, -1);
          continue;
        }
        if (ch >= ' ') value += ch;
      }
    };
    process.stdin.on('data', onData);
  });
}

async function main() {
  console.log(
    `Preparing AWS deployment for ${stack} in ${region}. This script creates billable resources after confirmation.`,
  );
  console.log('First check Billing credits/expiry and your budget alerts. Read docs/AWS_SETUP.md.');
  if ((await question('Continue preparing a deployment? Type yes: ')).trim() !== 'yes') return;
  const account = json(aws(['sts', 'get-caller-identity'])).Account;
  if (!/^\d{12}$/.test(account)) throw new Error('AWS account identity unavailable.');
  console.log(`Authenticated account ending ${account.slice(-4)}; region ${region}.`);
  const accessCode = await secret('Demo access code (12–128 characters, hidden; share privately with judges): ');
  if (accessCode.length < 12 || accessCode.length > 128) throw new Error('Access code must contain 12–128 characters.');
  const zip = await packageLambda();
  const bytes = await readFile(zip);
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 24);
  const bucket = `${stack.toLowerCase()}-deploy-${account}-${region}`;
  const head = aws(['s3api', 'head-bucket', '--bucket', bucket], undefined, true);
  if (head.status !== 0) {
    const create = ['s3api', 'create-bucket', '--bucket', bucket];
    if (region !== 'us-east-1') create.push('--create-bucket-configuration', `LocationConstraint=${region}`);
    aws(create);
  }
  aws([
    's3api',
    'put-public-access-block',
    '--bucket',
    bucket,
    '--public-access-block-configuration',
    'BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true',
  ]);
  aws([
    's3api',
    'put-bucket-encryption',
    '--bucket',
    bucket,
    '--server-side-encryption-configuration',
    '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}',
  ]);
  const key = `lambda/${hash}.zip`;
  aws(['s3', 'cp', zip, `s3://${bucket}/${key}`, '--only-show-errors']);
  const exists = aws(['cloudformation', 'describe-stacks', '--stack-name', stack], undefined, true);
  const changeSetName = `sophia-${Date.now()}`;
  const input = {
    StackName: stack,
    ChangeSetName: changeSetName,
    ChangeSetType: exists.status === 0 ? 'UPDATE' : 'CREATE',
    Description: 'Sophia explicit deployment; minimal runtime permissions and bounded demo usage.',
    TemplateBody: await readFile(join(root, 'infra', 'template.yaml'), 'utf8'),
    Capabilities: ['CAPABILITY_IAM'],
    Tags: [{ Key: 'Project', Value: 'Sophia' }],
    Parameters: [
      ['ArtifactBucket', bucket],
      ['ArtifactKey', key],
      ['AccessCode', accessCode],
      ['BedrockModelId', model],
      ['MaxDailyModelCalls', String(dailyCalls)],
      ['ReservedConcurrency', String(concurrency)],
      ['SpokenReplies', voice],
    ].map(([ParameterKey, ParameterValue]) => ({ ParameterKey, ParameterValue })),
  };
  aws(['cloudformation', 'create-change-set', '--cli-input-json', 'file:///dev/stdin'], input);
  const waited = aws(
    ['cloudformation', 'wait', 'change-set-create-complete', '--stack-name', stack, '--change-set-name', changeSetName],
    undefined,
    true,
  );
  const changes = json(
    aws(['cloudformation', 'describe-change-set', '--stack-name', stack, '--change-set-name', changeSetName]),
  );
  if (waited.status !== 0)
    throw new Error(`Change set did not become executable: ${changes.StatusReason || waited.stderr}`);
  console.log('Review these concrete changes:');
  for (const change of changes.Changes || []) {
    const r = change.ResourceChange || {};
    console.log(
      `${r.Action}: ${r.LogicalResourceId} (${r.ResourceType})${r.Replacement ? ` replacement=${r.Replacement}` : ''}`,
    );
  }
  console.log(`Inspect in AWS Console → CloudFormation → ${stack} → Change sets → ${changeSetName}.`);
  if ((await question('Execute this change set and publish the site? Type deploy: ')).trim() !== 'deploy') {
    console.log('Stopped before execution. The change set and private deployment ZIP remain for review.');
    return;
  }
  aws(['cloudformation', 'execute-change-set', '--stack-name', stack, '--change-set-name', changeSetName]);
  console.log('Waiting for AWS resources; CloudFront can take several minutes.');
  aws([
    'cloudformation',
    'wait',
    exists.status === 0 ? 'stack-update-complete' : 'stack-create-complete',
    '--stack-name',
    stack,
  ]);
  const deployed = json(aws(['cloudformation', 'describe-stacks', '--stack-name', stack])).Stacks?.[0];
  const outputs = Object.fromEntries((deployed?.Outputs || []).map(item => [item.OutputKey, item.OutputValue]));
  if (!outputs.SiteBucket || !outputs.DistributionId)
    throw new Error('Stack completed but frontend outputs were not found.');
  aws([
    's3',
    'sync',
    join(root, 'public'),
    `s3://${outputs.SiteBucket}`,
    '--cache-control',
    'public,max-age=300',
    '--only-show-errors',
  ]);
  aws(['cloudfront', 'create-invalidation', '--distribution-id', outputs.DistributionId, '--paths', '/*']);
  console.log(`Sophia: ${outputs.SiteUrl}`);
  console.log(`MCP endpoint: ${outputs.McpUrl} (send Authorization: Bearer <access code>)`);
  console.log(`Deployment bucket (outside stack): ${bucket}`);
  console.log('Keep the access code private. Test unlock, plan, split, finish, and history before recording.');
}
main().catch(error => {
  console.error(`Deployment stopped: ${error.message}`);
  process.exitCode = 1;
});
