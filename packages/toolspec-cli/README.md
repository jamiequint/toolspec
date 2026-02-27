# toolspec-cli

CLI for ToolSpec install, verification, review submission, and uninstall.

## Usage

```bash
npx -y toolspec-cli@0.1.1 install
toolspec prepare # optional, approve auto-prepares if missing
toolspec verify
toolspec approve
toolspec search linear
toolspec submit # optional direct submit
toolspec submit all # optional direct submit with unknown prompts
toolspec submit all --yolo # optional direct submit include-all
toolspec uninstall
```
