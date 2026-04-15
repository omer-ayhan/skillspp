## Feature summary

Add a **skill audit** command that can analyze either:

- a local **skills folder**,
- an entire **skill repository**, or
- a **single skill file**.

## Requirements / Features

1. **Target selection**
   - Support auditing a folder, repo, or single file.
   - Scan and select target files based on audit conditions/requirements.

2. **Scoring and validation**
   - Score skill files according to the audit conditions/requirements.
   - If any skill file is invalid, **stop the process** and return a clear error indicating which skills are invalid and why.

3. **Recommendations / tips**
   - After a successful audit, recommend prompts and provide tips to improve the skill files.
   - Provide references/resources for skill improvements.

4. **Agent selection (optional)**
   - Provide an option to select one or more agents; the selected agents should affect the audit result.
   - If no agents are selected, use a **universal** default.

## Acceptance criteria

- Running the audit command against each target type (folder, repo, single file) produces a consistent report.
- Invalid skill files cause the audit to fail fast with actionable error output.
- A successful audit includes both scores and improvement recommendations.
- Agent selection changes the audit output; universal default is used when none is provided.
