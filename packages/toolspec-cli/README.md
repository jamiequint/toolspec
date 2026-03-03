# toolspec-cli

CLI for ToolSpec install, verification, review submission, and uninstall.

## Usage

```bash
npx -y toolspec-cli@0.1.1 install
toolspec verify
toolspec review # prints non-interactive review metadata + JSON schema
toolspec search linear
toolspec submit --review-file /path/to/review.json
toolspec submit --review-json '{"agent_model":"claude-code","reliable_tools":["mcp__linear__list_issues"],"unreliable_tools":[],"hallucinated_tools":[],"never_used_tools":[],"behavioral_notes":["aggregate-only"],"failure_modes":[{"symptom":"timeout","likely_cause":"rate-limit","recovery":"retry","frequency":"occasional"}]}'
toolspec uninstall
```
