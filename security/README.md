# Security Audit Summary

This directory contains a static-analysis security review of the NDM repository. No application source code was modified; the deliverables below capture attack-surface mapping, suspicious-code inventory, and per-finding exploitability analysis.

## Methodology

1. Enumerated repository entry points by reading controllers, guards, config/env readers, workflow callbacks, queue consumers, shell/process launchers, and storage-management clients.
2. Traced tainted data from those entry points into filesystem, process, network, authz, and deserialization sinks.
3. Wrote one exploitability note per suspicious sink, explicitly separating confirmed issues from likely/theoretical/false-positive cases.
4. Prioritized issues that affect credential handling, shell execution, storage-management trust, and cross-tenant data boundaries.

## Deliverables

- [01-attack-surface.md](./01-attack-surface.md)
- [02-suspicious-code.md](./02-suspicious-code.md)
- [exploits/README.md](./exploits/README.md)

## Risk dashboard

| Severity | Confirmed | Likely | Theoretical | False Positive | Total |
| --- | ---: | ---: | ---: | ---: | ---: |
| Critical | 1 | 1 | 0 | 0 | 2 |
| High | 2 | 3 | 0 | 0 | 5 |
| Medium | 2 | 1 | 0 | 0 | 3 |
| Low | 0 | 0 | 1 | 2 | 3 |
| **Total** | **5** | **5** | **1** | **2** | **13** |

## Top 5 urgent issues

1. [SC-006](./exploits/SC-006.md) — Worker protocol commands interpolate host/user/password/path values into `exec()`-backed shell strings, creating a direct worker RCE path.
2. [SC-001](./exploits/SC-001.md) — Jobs-service mount helpers shell out through `exec()` with unquoted mount arguments taken from job/file-server data.
3. [SC-004](./exploits/SC-004.md) — Isilon management clients explicitly disable TLS hostname verification while sending Basic-auth credentials.
4. [SC-007](./exploits/SC-007.md) — `db-writer` exposes an unauthenticated consumer-bootstrap endpoint that starts background queue work.
5. [SC-003](./exploits/SC-003.md) — Shared authz logic trusts a caller-supplied `projectId` header for project scoping, enabling likely cross-project access paths.

## Disclaimer

This is a **static-analysis audit**, not a live penetration test. No proof-of-concept payloads were executed, and exploit notes describe plausible attack paths derived from code inspection only.
