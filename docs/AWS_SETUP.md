# Deploying Sophia on AWS

Sophia runs fully on your computer with `npm start`. This guide is for the hosted version, which adds Amazon Bedrock for natural-language conversation and DynamoDB for saved households.

## Architecture

```text
Browser (web app, voice, kitchen mode)          Any MCP client (Claude Desktop, Kiro, ...)
        |                                                   |
  CloudFront (HTTPS)                                 API Gateway URL
   /            \                                           |
private S3     /api/*  ------------------------------------>+
static app        |
          API Gateway HTTP API
                  |
          Lambda (Node.js 22, arm64)
           |               |                |
   /api/chat agent    /api/mcp         Sophia kitchen engine
   Bedrock Converse   MCP server        (the only code that changes state)
   tool use                                  |
                                     DynamoDB (households, history, daily model quota)
```

- **Amazon Bedrock** (Converse API with tool use) turns what the cook says into calls to Sophia's tools. The model never edits state directly; every tool call goes through the same validated engine as the buttons.
- **AWS Lambda + API Gateway** serve the REST API and the MCP endpoint from one function.
- **Amazon DynamoDB** (on demand) stores each household with conditional writes, a 60-day expiry and an atomic daily model-call quota.
- **Amazon S3 + CloudFront** host the static web app privately through Origin Access Control.
- **Amazon Polly** (neural voice Kajal, Indian English) speaks Sophia's replies when Voice replies is on. If Polly fails or its daily limit is reached, the browser's own voice takes over.
- **CloudWatch Logs** keep 7 days of request and function logs.

Everything is defined in [`infra/template.yaml`](../infra/template.yaml). There is no always-on server, NAT gateway, GPU or provisioned throughput.

## Security and cost guardrails

- A shared demo access code (12–128 characters) gates the hosted app; the browser gets a signed HttpOnly cookie. MCP clients send the same code as a Bearer token.
- The Lambda role can only write its own log group, read/write its own table, invoke the one configured Bedrock model, and call Polly's SynthesizeSpeech.
- Daily model-call quota (default 200), a separate daily Polly limit (default 300 replies), API throttling (2 requests/second, burst 5), reserved concurrency 2, short timeouts, capped output tokens.
- To stop all compute immediately: Lambda → the Sophia function → Configuration → Concurrency → set reserved concurrency to 0.

These limit exposure but are not a hard spending cap. Set an AWS Budgets alert before deploying.

## Deploy

Prerequisites: Node.js 22+, npm, `zip`, [AWS CLI v2](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html).

1. **Sign in.** Use your AWS console sign-in from the CLI (no access keys needed):

   ```sh
   aws login --profile sophia --region us-east-1
   npm run doctor -- --region us-east-1 --profile sophia --live
   ```

2. **Check the model.** In the Bedrock console for your region, open the model catalog and try the model once in the playground. Sophia's template uses direct regional model ids such as `amazon.nova-lite-v1:0` or `amazon.nova-micro-v1:0` (both support tool use). Cross-region inference profiles (`us.amazon...`) need extra IAM permissions.

3. **Run locally against Bedrock first** (billable, a few cents):

   ```sh
   AWS_PROFILE=sophia AWS_REGION=us-east-1 SOPHIA_PROVIDER=bedrock BEDROCK_MODEL_ID=amazon.nova-lite-v1:0 SOPHIA_VOICE=polly npm start
   ```

4. **Deploy the stack:**

   ```sh
   node scripts/deploy-aws.mjs --region us-east-1 --profile sophia --stack sophia-demo --model amazon.nova-lite-v1:0 --daily-calls 200 --voice polly
   ```

   The script checks your identity, asks for the demo access code (hidden input), packages the Lambda ZIP, creates a CloudFormation change set, shows you the resource changes and waits until you type `deploy`. It then uploads `public/`, refreshes CloudFront and prints the site URL and the MCP endpoint.

New AWS accounts often have a Lambda limit of 10 concurrent executions and cannot reserve any of it. If the deploy fails on reserved concurrency, run it again with `--concurrency -1` (no reservation; API Gateway throttling and the daily model quota still apply).

## Troubleshooting

- **`ValidationException: Operation not allowed`** on every Bedrock call, and `aws bedrock get-foundation-model-availability --model-id amazon.nova-lite-v1:0` shows `"authorizationStatus": "NOT_AUTHORIZED"`: check `aws freetier get-account-plan-state`. Accounts on the AWS **Free plan** can't call Bedrock models; upgrade to the Paid plan in the console (remaining Free plan credits carry over). Polly, Lambda, DynamoDB, S3 and CloudFront work on either plan.
- Sophia writes the underlying AWS error to the server log (the terminal locally, CloudWatch when deployed) as `[sophia] Bedrock request failed: ...`.

## Check the deployment

1. Open the site URL and unlock with your access code. A visitor without it cannot reach the API.
2. Say or type "Dal for the three of us, Ravi likes it spicy". Check that the plan shows Ravi's red chilli tadka only in his finishing step.
3. Complete a few steps, close the tab, reopen it, and ask "where was I?". The session resumes from DynamoDB.
4. Try removing an ingredient that is already in the pot; Sophia refuses and nothing changes.
5. Turn on Voice replies and send a message; you should hear the Kajal voice.
6. Connect an MCP client to `<ApiUrl>/api/mcp` with the header `Authorization: Bearer <access code>` and call `get_kitchen_state`.
7. In CloudWatch, check the function logs; in Billing, check the cost after a day.

## Remove everything

Empty the site bucket, then delete the CloudFormation stack (this deletes the DynamoDB table and its data). Delete the separate deployment bucket the script created (`<stack>-deploy-<account>-<region>`) and any leftover change sets.
