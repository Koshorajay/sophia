/** Local readiness checks by default. --live adds only STS identity lookup. No deploy/inference. */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const options = {};
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--live') options.live = true;
  else if (['--region', '--profile'].includes(args[i]) && args[i + 1] && !args[i + 1].startsWith('--'))
    options[args[i].slice(2)] = args[++i];
  else throw new Error('Use npm run doctor -- [--region REGION] [--profile NAME] [--live].');
}
const rows = [];
const check = (name, ready, detail) => rows.push({ name, ready, detail });
const run = (command, argv) => spawnSync(command, argv, { encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024 });
check('Node.js', Number(process.versions.node.split('.')[0]) >= 22, `Node ${process.versions.node}; need 22 or newer.`);
for (const name of [
  '@aws-sdk/client-bedrock-runtime',
  '@aws-sdk/client-dynamodb',
  '@aws-sdk/lib-dynamodb',
  '@modelcontextprotocol/sdk',
]) {
  // The MCP SDK publishes only subpath exports.
  try {
    require.resolve(name === '@modelcontextprotocol/sdk' ? `${name}/server/index.js` : name);
    check(name, true, 'Installed locally.');
  } catch {
    check(name, false, 'Run npm ci in this folder.');
  }
}
const zip = run('zip', ['-v']);
check(
  'ZIP utility',
  zip.status === 0,
  zip.status === 0 ? 'Available for Lambda packaging.' : 'Install zip before deployment.',
);
const cli = run('aws', ['--version']);
const hasCli = cli.status === 0 && /aws-cli\/2\./.test((cli.stdout || '') + (cli.stderr || ''));
check(
  'AWS CLI v2',
  hasCli,
  hasCli ? 'Installed.' : 'Missing or not version 2. Follow the official AWS CLI installation guide.',
);
const template = await readFile(resolve(root, 'infra/template.yaml'), 'utf8');
check(
  'Infrastructure guardrails',
  ['NoEcho: true', 'BlockPublicPolicy: true', 'BillingMode: PAY_PER_REQUEST', 'MaxDailyModelCalls'].every(x =>
    template.includes(x),
  ),
  'Template present; run node scripts/check-aws.mjs for the offline adapter checks.',
);
check(
  'Credit and alerts',
  false,
  'Account-specific: manually confirm remaining credit, expiry, eligible services and billing alerts. Not inspected.',
);
console.log('Sophia readiness - no resources are created and no model is called.');
for (const row of rows) console.log(`${row.ready ? 'READY' : 'ACTION'} | ${row.name} | ${row.detail}`);
if (options.live) {
  if (!hasCli) throw new Error('Cannot check authentication until AWS CLI v2 is installed.');
  if (!options.region || !/^[a-z]{2}(?:-[a-z]+)+-\d$/.test(options.region))
    throw new Error('Choose your region explicitly with --region.');
  const command = ['sts', 'get-caller-identity', '--region', options.region, '--no-cli-pager', '--output', 'json'];
  if (options.profile) command.push('--profile', options.profile);
  const identity = run('aws', command);
  if (identity.status !== 0)
    throw new Error(
      'AWS identity check failed. Sign in to the chosen profile in your own terminal, then retry. No deployment or inference was attempted.',
    );
  const account = JSON.parse(identity.stdout).Account;
  if (!/^\d{12}$/.test(account || '')) throw new Error('AWS did not return the expected account identity.');
  console.log(
    `READY | Authentication | Account ending ${account.slice(-4)}; selected region ${options.region}. Model access, costs and deployment remain unverified.`,
  );
} else
  console.log(
    'AWS account was not contacted. After signing in, add --region REGION --profile NAME --live for a read-only authentication check.',
  );
console.log('Next: read docs/AWS_SETUP.md. Deployment still requires its separate review and confirmation.');
