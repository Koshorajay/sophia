# Sophia

**One shared meal. Different plates. Smarter groceries.**

Sophia is a cooking companion for Alexa+. It helps one person cook one meal for a household where everyone wants it a little different: no chilli for the kids, an egg for one person, no paneer for another. It plans a shared preparation, keeps anything that differs out of the pot, tells you exactly when to split into named portions, and then finishes each plate its own way.

Sophia's kitchen is an **MCP server** (spec 2025-11-25, Streamable HTTP), the open standard Alexa+ integrations use. The web app in this repo simulates the Alexa+ experience on an Echo Show-style screen: you talk, an Amazon Bedrock agent calls Sophia's tools, and Sophia talks back.

> Built for the [Amazon Developer "Build, Ship, Shape" hackathon](https://amazonappdev2026.devpost.com/), Alexa+ track and AWS Builder mini challenge.
> Demo video: **[link]** · Hosted demo: **https://p2h4hezy1h.execute-api.us-east-1.amazonaws.com** (access code in the Devpost testing notes)

## What it does

- **Splits at the right moment.** "Dal for the three of us, Ravi likes it spicy." Sophia cooks one pot of dal, splits it, and gives only Ravi's bowl a red chilli tadka.
- **Knows what's already in the pot.** "Actually, no chilli for Ravi" works until his tadka happens. "Remove the onion" after the onion is cooked is refused, with the reason. The AI can't talk its way around this: every action goes through a deterministic kitchen engine.
- **Hands-free kitchen mode.** Big-type steps, voice control ("next", "repeat", "start the timer") and step timers.
- **Talks back.** Turn on Voice replies and Sophia reads every answer and each new step aloud: with the Amazon Polly neural voice Kajal (Indian English) when deployed, or the browser's own voice locally.
- **Checks the pantry before you start.** "Do I have everything for dal?" lists what's short, and "add them to my shopping list" saves it. Nothing is ever ordered or paid for.
- **Remembers across sessions.** Household preferences, the meal in progress ("where was I?") and every meal you confirm cooking.
- **Groceries from what you actually cooked.** Monthly staples and weekly fresh items come only from meals you confirmed cooking, never from recipes you merely asked about, and each line says why it's there.

## How it works

```text
 Voice / text (web app, Alexa+ simulation)        Any MCP client (Claude Desktop, Kiro, ...)
                 |                                                |
        Bedrock agent (Converse tool use)                         |
                 |                                                |
                 +-----------> Sophia MCP tools <-----------------+
                               search_recipes, plan_meal, get_kitchen_state,
                               complete_current_step, alter_portion, finish_meal,
                               cancel_meal, update_pantry, forecast_groceries,
                               check_pantry, add_to_shopping_list, update_shopping_list
                                         |
                              Kitchen engine (src/engine.mjs)
                              the only code that changes state
                                         |
                       Local file store  or  Amazon DynamoDB
```

Every recipe step records which ingredients it puts into the food. That one rule gives Sophia most of its behaviour:

- Anything that differs between people lives in each person's finishing step, never in a shared step, so the split point falls out of the data.
- "Can I still remove X for Y?" is answered by checking whether a completed step already added X to Y's food.
- Finishing a meal records exactly what went in, once, and deducts it from the pantry estimate. The grocery forecast sums the last 28 days of confirmed meals.

The language model chooses which tool to call; the engine decides whether it's allowed. Buttons, chat, voice and external MCP clients all go through the same validated actions.

## Run it locally

Requires Node.js 22+.

```sh
npm ci
npm start
```

Open http://localhost:4173 in Chrome or Edge (voice input uses the browser's speech recognition). Your household is saved in `.data/` and restored when you come back.

Without AWS credentials, the chat uses a small offline keyword parser ("Cook dal for 3", "next", "done", "make Ravi's spicy"); the buttons, kitchen mode and the MCP server work fully. For natural conversation, run with Amazon Bedrock:

```sh
aws login --profile sophia --region us-east-1
AWS_PROFILE=sophia AWS_REGION=us-east-1 SOPHIA_PROVIDER=bedrock BEDROCK_MODEL_ID=amazon.nova-lite-v1:0 SOPHIA_VOICE=polly npm start
```

`SOPHIA_VOICE=polly` makes spoken replies use Amazon Polly's Kajal voice; leave it out to use the browser's voice.

If Bedrock can't answer (for example, an AWS account where Bedrock isn't enabled yet, or a timeout), the chat keeps working with the offline parser and the chat header shows an "Offline mode" badge. The real AWS error goes to the server log.

## Use Sophia from any MCP client

`npm start` also serves an MCP server at **http://localhost:4173/api/mcp** (also `/mcp` locally; Streamable HTTP, protocol `2025-11-25`, built with the official `@modelcontextprotocol/sdk`). Any MCP client, such as Claude Desktop, Claude Code or Kiro, can cook through it. The deterministic engine still decides every change.

| Tool | What it does |
| --- | --- |
| `search_recipes` | Find dishes and the per-person finishes (variants) each one supports |
| `get_kitchen_state` | Household preferences, active meal, current step, portions and shortages |
| `plan_meal` | Start a dish; omit `portions` to use everyone's saved preference |
| `complete_current_step` | Confirm the step the cook just finished (the split cannot be skipped) |
| `alter_portion` | Switch one person's finish or omit an ingredient that has not been added yet |
| `finish_meal` / `cancel_meal` | Record the meal as cooked once, or abandon it without recording anything |
| `update_pantry` / `forecast_groceries` | Set confirmed stock; estimate groceries from confirmed cooked meals |
| `check_pantry` | What a dish (or the active meal) needs beyond the entered stock |
| `add_to_shopping_list` / `update_shopping_list` | Save what's missing to the household list; tick off, remove or clear items. Nothing is ordered |

Most clients take a URL plus optional headers:

```json
{
  "mcpServers": {
    "sophia": {
      "type": "http",
      "url": "http://localhost:4173/api/mcp",
      "headers": { "Authorization": "Bearer <access code, only if SOPHIA_ACCESS_CODE is set>" }
    }
  }
}
```

With Claude Code: `claude mcp add --transport http sophia http://localhost:4173/api/mcp`. A client that only runs local commands can use a bridge such as `npx mcp-remote http://localhost:4173/api/mcp`.

Each MCP session gets its own demo household. To cook in the same household as the browser, open `/api/state` in that browser, copy `householdId`, and pass it as the `householdId` argument of any tool. A deployed stack serves the same endpoint at `/api/mcp` on the site URL or the API Gateway URL. It needs `Authorization: Bearer <access code>` or the web app's signed session cookie.

## Deploy on AWS

One CloudFormation stack: CloudFront + private S3 for the app, API Gateway + Lambda for the API and MCP endpoint, DynamoDB for households, Bedrock for the agent, Polly for spoken replies, least-privilege IAM. See [docs/AWS_SETUP.md](docs/AWS_SETUP.md).

## Recipes

30 dishes with 3 finishes each, mostly everyday Indian vegetarian and egg meals. Chilli never enters a shared pot; dal gets a tadka per bowl; palak's paneer (or sweet corn) goes in after the split. See [docs/RECIPES.md](docs/RECIPES.md) to add your own; no model training needed.

## Tests

```sh
npm test            # engine, recipes, MCP server, agent (mocked Bedrock), storage, Lambda adapter
npm run check       # syntax
node scripts/check-aws.mjs   # offline infrastructure guardrails
```

Every dish and every finish is walked through planning, the split, completion, pantry deduction and the grocery forecast.

## Project map

| Path | What's there |
| --- | --- |
| `src/engine.mjs` | Kitchen rules: plan, steps, split, alterations, finish, pantry, forecast |
| `src/recipes.mjs`, `src/data.mjs` | Recipe library and ingredient registry |
| `src/tools.mjs`, `src/mcp.mjs` | Tool definitions and the MCP server |
| `src/bedrock.mjs` | Bedrock Converse agent loop |
| `src/app.mjs`, `src/store.mjs` | HTTP API, sessions, persistence, quotas |
| `server.mjs`, `lambda.mjs` | Local server and AWS Lambda entry points |
| `public/` | Web app: Alexa+ simulation, kitchen mode, voice |
| `infra/`, `scripts/` | CloudFormation template, packaging and deployment |
| `tests/` | Automated tests |

## Limitations

- This is a simulation of the Alexa+ experience. Alexa+'s add-on developer tools are partner-only, so Sophia isn't connected to a real Echo; the MCP server is ready for any MCP client.
- Sophia can't see your kitchen. Steps count as done when you say so, and pantry amounts are estimates from recipes.
- Splitting a shared dish handles taste preferences, not allergies. Allergy-safe cooking needs separate ingredients and equipment from the start.
- Recipes are simplified templates written for this project; timings are approximate.
- The hosted demo uses one shared access code, not user accounts.

## License

MIT, see [LICENSE](LICENSE). Recipes and illustrations are original to this project. Sophia is an independent hackathon project and is not endorsed by Amazon.
