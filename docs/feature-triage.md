# Feature Triage, Scoring, and Scheduling

This document defines how new feature ideas for the Stellar Analytics Dashboard are captured, evaluated, prioritised, and scheduled for implementation.

---

## 1. Capturing ideas

Any contributor can submit a feature idea by opening a GitHub Issue using the **Feature Request** template. The template prompts for:

- **Problem statement** – what user need or gap does this address?
- **Proposed solution** – a brief description of the desired behaviour.
- **Acceptance criteria** – a bulleted list of measurable outcomes.
- **Affected area(s)** – frontend, API, indexer, shared, docs, DevOps.
- **Estimated effort** – S / M / L / XL (rough guess, refined during triage).

Ideas discussed in Discord, Slack, or in-person should be translated into a GitHub Issue before triage so there is a single traceable source of truth.

---

## 2. Triage meeting

The triage meeting runs **every two weeks** (suggested: first Monday of each sprint). Any maintainer can run it. Agenda:

1. Review new issues labelled `needs-triage` (≤ 30 min).
2. Score each issue using the RICE framework (section 3).
3. Assign a priority label and milestone (section 4).
4. Close or `wontfix` issues that do not fit the project scope.

Triage decisions are recorded as a comment on the issue so the submitter can see the reasoning.

---

## 3. Scoring: RICE framework

Each feature is scored on four dimensions. The final **RICE score** determines relative priority.

```
RICE = (Reach × Impact × Confidence) / Effort
```

### Reach — how many users or sessions does this affect per month?

| Score | Definition |
|-------|-----------|
| 100 | All users / every session |
| 50 | Majority of users (>50 %) |
| 25 | A significant segment (25–50 %) |
| 10 | A small segment (<25 %) |
| 1 | Edge case or internal tooling only |

### Impact — how much does it improve the experience for those users?

| Score | Definition |
|-------|-----------|
| 3 | Massive – removes a major blocker or enables a key workflow |
| 2 | High – meaningfully improves an existing workflow |
| 1 | Medium – nice to have, noticeable improvement |
| 0.5 | Low – minor convenience |
| 0.25 | Minimal – cosmetic or rarely noticed |

### Confidence — how confident are we in the reach and impact estimates?

| Score | Definition |
|-------|-----------|
| 100 % | Strong evidence (user research, metrics, direct feedback) |
| 80 % | Some evidence (a few data points or informed opinion) |
| 50 % | Gut feeling only |

### Effort — person-days of estimated implementation work

Count the total estimated days for design + implementation + testing + docs. Use story-point-like buckets:

| Label | Days |
|-------|------|
| XS | 0.5 |
| S | 1 |
| M | 3 |
| L | 8 |
| XL | 20 |

### Example

| Dimension | Value |
|-----------|-------|
| Reach | 50 (most users) |
| Impact | 2 (high) |
| Confidence | 80 % (0.8) |
| Effort | 3 days (M) |
| **RICE** | **(50 × 2 × 0.8) / 3 = 26.7** |

Higher RICE score = higher priority.

---

## 4. Priority labels and milestones

After scoring, assign one priority label and a milestone:

| Label | RICE score | Typical wait |
|-------|-----------|--------------|
| `priority: critical` | > 50 or security/data-loss | Current sprint |
| `priority: high` | 20–50 | Next sprint |
| `priority: medium` | 5–19 | Upcoming quarter |
| `priority: low` | < 5 | Backlog / someday |
| `wontfix` | Not aligned with project goals | Closed |

Milestones map to quarterly or release targets (e.g. `v1.3.0`, `Q3-2026`). Unscheduled backlog items use the `Backlog` milestone.

---

## 5. Scheduling

### Sprint planning

At the start of each sprint the maintainer:

1. Pulls the top-RICE issues from the `priority: high` column.
2. Checks that total estimated effort fits the sprint capacity.
3. Moves accepted issues to the current sprint milestone.
4. Assigns an owner (self-assign is encouraged).

An issue moves to **`status: in-progress`** when the assignee creates a branch for it.

### Capacity rule of thumb

Reserve ≈ 20 % of sprint capacity for bugs, docs, and unplanned work. Only commit to features for the remaining 80 %.

---

## 6. Full lifecycle

```
Idea submitted (GitHub Issue)
        │
        ▼
  Label: needs-triage
        │
        ▼ Triage meeting
  RICE score added as comment
  Priority label assigned
  Milestone set
        │
        ├─ wontfix → closed
        │
        ▼
  Backlog (priority: low/medium)
  or Sprint (priority: high/critical)
        │
        ▼ Sprint planning
  status: in-progress
  Assignee + branch created
        │
        ▼ PR opened
  Release notes preview comment posted (CI)
  Review + approve
        │
        ▼ Merged to main
  CHANGELOG updated on next tag
  Issue closed automatically (via "Closes #N" in PR)
```

---

## 7. GitHub Issue template

Create `.github/ISSUE_TEMPLATE/feature_request.yml` (or use the existing template) with the following fields. A starter template is provided below.

```yaml
name: Feature Request
description: Propose a new feature or enhancement
labels: ["needs-triage"]
body:
  - type: markdown
    attributes:
      value: |
        Thanks for suggesting a feature! Please fill in as much detail as you can.
        A maintainer will score and prioritise this during the next triage meeting.

  - type: textarea
    id: problem
    attributes:
      label: Problem statement
      description: What user need or gap does this address?
    validations:
      required: true

  - type: textarea
    id: solution
    attributes:
      label: Proposed solution
      description: Brief description of the desired behaviour.
    validations:
      required: true

  - type: textarea
    id: acceptance
    attributes:
      label: Acceptance criteria
      description: Bulleted list of measurable outcomes.
      placeholder: |
        - [ ] ...
        - [ ] ...
    validations:
      required: true

  - type: dropdown
    id: area
    attributes:
      label: Affected area(s)
      multiple: true
      options:
        - frontend
        - api
        - indexer
        - shared
        - docs
        - devops / ci
    validations:
      required: true

  - type: dropdown
    id: effort
    attributes:
      label: Estimated effort (your guess)
      options:
        - XS (< 1 day)
        - S (1 day)
        - M (3 days)
        - L (1–2 weeks)
        - XL (> 2 weeks)
        - Not sure
```

---

## 8. Triage comment template

After scoring, post a comment on the issue using this template:

```
## Triage result

| Dimension | Value |
|-----------|-------|
| Reach | _N_ |
| Impact | _N_ |
| Confidence | _N %_ |
| Effort | _N days_ |
| **RICE** | **_score_** |

**Priority**: `priority: high` / `priority: medium` / etc.
**Milestone**: _vX.Y.Z_ / _Q3-2026_ / _Backlog_
**Notes**: _Any context, dependencies, or follow-up questions._
```

---

## 9. Escalation

Issues that cannot wait for the next triage meeting (security vulnerabilities, data-loss bugs, or production incidents) should be labelled `priority: critical` immediately and brought to a maintainer's attention via the project's communication channel. They bypass the scoring process and go directly into the current sprint.

---

## Acceptance criteria

- [ ] All new feature issues are labelled `needs-triage` on creation.
- [ ] Triage runs at least once per sprint; RICE scores are posted as issue comments.
- [ ] Every triaged issue has a priority label and a milestone.
- [ ] The process is documented here and linked from `CONTRIBUTING.md`.

---

## See Also

- [Contributing Guide](../CONTRIBUTING.md)
- [Release Notes Process](./release-notes-process.md)
- GitHub Issues: filter by `needs-triage` to see the current backlog
