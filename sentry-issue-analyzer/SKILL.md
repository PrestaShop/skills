---
name: sentry-issue-analyzer
description: Fetch a Sentry issue by ID and analyze whether it is pertinent for the autoupgrade module maintainers. Use when the user wants to investigate a specific Sentry issue.
requires:
  bins: ["sentry"]
  auth: true
---

# Sentry — Issue Analyzer

Fetch a specific Sentry issue and analyze whether it requires action from the autoupgrade module maintainers.

## Input

The user provides a Sentry issue ID (numeric, e.g. `7357760215`) or short ID (e.g. `AUTOUPGRADE-MODULE-2DM`). Extract this from the user's message.

## Steps

### 1. Fetch issue overview

```bash
sentry issue view <ISSUE_ID> --json 2>/dev/null
```

Extract: `title`, `count`, `firstSeen`, `lastSeen`, `permalink`, `shortId`, `firstRelease.version`.

### 2. Fetch latest event details

```bash
sentry api /organizations/prestashop/issues/<ISSUE_ID>/events/latest/ 2>/dev/null
```

Extract:
- `message` or `logentry.formatted` — the error text
- `exception.values[].stacktrace.frames` — stack frames (if present)
- `tags` — look for `phpVersion`, `release`, `source`, `url`
- `contexts` — browser, OS, runtime info
- `breadcrumbs` — sequence of events leading to the error

### 3. Identify the error source

Check the `source` tag:
- `feedbackModal` → user manually submitted feedback; the message content was typed/pasted by the user, not captured automatically. The event may not have a real stacktrace.
- `captureException` / `captureMessage` / other → automatically captured error.

Check the `url` tag to determine which page/route triggered the error.

### 4. Cross-reference with the codebase

Search the repo for the error message string to find the originating PHP or JS code:
```bash
grep -r "<key phrase from error>" classes/ _dev/src/ --include="*.php" --include="*.ts" -l
```

### 5. Analyze and display

Output a structured analysis in Markdown:

---

## Issue: [SHORT_ID](permalink) — Title

| Field | Value |
|---|---|
| Count | N occurrences |
| First seen | YYYY-MM-DD |
| Last seen | YYYY-MM-DD |
| Release | vX.Y.Z |
| PHP version | X.Y.Z |
| Route/URL | ... |
| Capture source | feedbackModal / automatic |

### What happened
[Plain-language description of the error and its context.]

### Source in codebase
[File and line where the error originates, if found. Link to the relevant class.]

### Is this pertinent for maintainers?

Answer **Yes / Possibly / No** with reasoning:

- **Yes** — if it's an automatically captured error with a stacktrace pointing to our code, or a recurring issue (count > 5) suggesting a systematic problem.
- **Possibly** — if it's a user-submitted feedback describing a real failure but may be environment-specific.
- **No** — if it's a one-off environment issue (permissions, disk space, hosting), a misconfiguration, or if our code already handles the error correctly and the failure is outside our control.

### Recommended action
[Concrete next step: investigate, close as environment issue, improve error message, create Jira ticket, etc.]

---

## Notes

- The org/project target is always `prestashop/autoupgrade-module`.
- If the JSON output has a warning line before it, strip everything before the first `{` or `[`.
- `source: feedbackModal` means the error message was submitted manually through the UI feedback form — treat the content as user-reported, not as an automatically caught exception.
