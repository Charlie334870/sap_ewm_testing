# Let Claude use the tools

The platform has no built-in agent yet (that is Milestone 3 and needs a Claude API key). Until
then Claude Desktop can do the investigating: it connects to the platform through MCP, reads a
ticket, and runs the read-only SAP tools. Claude reasons with your normal Claude subscription;
the platform supplies the tools, enforces the rules and keeps the record.

What Claude can do through this connection: read the tickets of one project, read its SAP
systems, run the read-only tools. What it cannot do: create or change tickets, change anything in
SAP, see another project, or see users, tokens and audit logs. These limits are enforced by the
platform, not by Claude's good behaviour.

## Steps

1. **Install** [Claude Desktop](https://claude.ai/download) and [Node.js LTS](https://nodejs.org)
   on the computer where the platform runs. Sign in to Claude Desktop with your Claude account.
2. **Start the platform** (`docker compose up`) and open <http://localhost:3000>.
3. **Create a token.** In the console choose _Agent access_ (bottom left) → _Create token_. Copy
   the token; it is shown once.
4. **Fill in the folder** where you cloned the code, in step 2 on that page. The page then shows
   the exact configuration, with your token and path filled in. Press _Copy configuration_.
5. **In Claude Desktop** open Settings → Developer → Edit Config. This opens
   `claude_desktop_config.json`. Paste the configuration and save. If the file already has an
   `mcpServers` block, add only the `ewm-agent` entry inside it.
6. **Quit Claude Desktop completely** (on Windows also from the system tray) and start it again.
7. In a new chat, check that `ewm-agent` is listed under Connectors, then ask:

   > Investigate ticket MUHW-1 with the ewm-agent tools.

   Claude asks for permission before each tool call. Every call appears in the console under
   **SAP Systems** → the system → _Recent tool calls_, marked _through agent access_.

The configuration looks like this:

```json
{
  "mcpServers": {
    "ewm-agent": {
      "command": "node",
      "args": ["C:\\Users\\you\\sap_ewm_testing\\apps\\mcp\\dist\\ewm-mcp.mjs"],
      "env": {
        "EWM_API_URL": "http://localhost:3000",
        "EWM_API_TOKEN": "ewm_pat_..."
      }
    }
  }
}
```

## Try it on the practice scenarios

1. Register a simulated system and press _Create the practice tickets_ ([SETUP.md](SETUP.md), step 7).
2. Ask Claude to investigate each ticket. A good investigation ends with a root cause, the call
   IDs of the evidence, and a proposed fix for a consultant to approve.
3. Compare with what you, as the EWM expert, would have concluded. Tell me where Claude went
   wrong or where the scenario is unrealistic; both improve the next milestone.

The answer keys are in `tests/scenarios/answer-keys.ts`. They are deliberately not reachable
through any tool. Look at them only after Claude has finished.

## If something goes wrong

| What you see                                              | What to do                                                                                                                              |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `ewm-agent` is not listed in Claude Desktop               | The configuration file is not valid JSON, or Claude Desktop was not fully restarted. Check for a missing comma or bracket.              |
| The server shows as failed                                | Open the log: `%APPDATA%\\Claude\\logs\\mcp-server-ewm-agent.log` (Windows) or `~/Library/Logs/Claude/` (Mac). The first lines say why. |
| `Cannot find module ...ewm-mcp.mjs`                       | The folder path is wrong. In the JSON every backslash must be doubled (`C:\\\\Users\\\\...`). The console page does this for you.       |
| `node` is not recognised                                  | Node.js is not installed, or Claude Desktop was started before installing it. Install it, then restart Claude Desktop.                  |
| `EWM_API_TOKEN is not set`                                | The `env` block is missing or misspelled in the configuration.                                                                          |
| `This access token is not valid`                          | The token expired or was revoked. Create a new one under _Agent access_ and replace it in the configuration.                            |
| `The EWM Agent platform ... is not reachable`             | The platform is not running. Start it with `docker compose up`.                                                                         |
| A tool call says the tool cannot run over the API sandbox | Correct: SAP has released no API for that data. Use the simulated system for those tools.                                               |

## Without Node.js: run the MCP server in Docker

This variant needs only Docker. It has not been tried on a real machine yet, so prefer the Node.js
variant above and tell me if you test this one.

```bash
docker compose --profile agent build mcp
```

```json
{
  "mcpServers": {
    "ewm-agent": {
      "command": "docker",
      "args": [
        "compose",
        "-f",
        "C:\\Users\\you\\sap_ewm_testing\\compose.yaml",
        "--profile",
        "agent",
        "run",
        "--rm",
        "-T",
        "--no-deps",
        "mcp"
      ],
      "env": { "EWM_API_TOKEN": "ewm_pat_..." }
    }
  }
}
```

## Good to know

- The token acts as you, in one project, read-only. Revoke it under _Agent access_ at any time.
- Do not put the token in a chat, an email or the repository.
- What Claude reads (ticket text, SAP data) is sent to Anthropic as part of your conversation.
  With simulated data and SAP's demo data that is harmless. Before a client's data is ever
  involved, the client has to agree in writing.
- Claude's conclusions on simulated data are practice results. The platform marks every result
  with its source, and Claude is instructed to repeat that in its answer.
