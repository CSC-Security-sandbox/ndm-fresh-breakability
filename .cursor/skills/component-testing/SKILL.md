---
name: ndm-component-testing
description: Write component-level tests for NDM backend microservices (worker, jobs-service, config-service, reports-service, support-service, db-writer, admin-service). Use when the user asks to write component tests, add tests for an activity or controller, wire real classes together, test a Temporal activity, test a cron handler, test a Redis consumer, or asks why unit tests are not enough for a specific entry point. Also use when asked about the 2-class rule for deciding component vs unit test.
---

# NDM Component Testing

## Overview

Component tests wire **all real classes** inside one microservice from an entry point (HTTP controller, Temporal activity, cron, Redis consumer) to the external boundary, mocking **only outermost boundaries** (DB, Temporal, Redis, external HTTP, filesystem).

Tests run entirely in-process — no real infrastructure (DB, Redis, Temporal, HTTP servers).

**Output location:** `services/<service-name>/src/component-tests/`

**Unit vs component vs E2E** (see [unit-testing/SKILL.md](../unit-testing/SKILL.md) for unit tests):

| Level | Real code | Mocked |
|-------|-----------|--------|
| **Unit** | 1 class under test | All dependencies |
| **Component** | All classes inside one service | External boundaries only |
| **E2E** | Full stack | Nothing (real infra) — see [e2e-testing](../e2e-testing/SKILL.md) and [ui-testing](../ui-testing/SKILL.md) |

**Why component tests exist:**

- Unit tests mock every dependency — class-to-class contract bugs (wrong DTO field, wrong argument shape) stay hidden
- E2E tests are slow, infrastructure-dependent, and rarely cover negative paths (DB failure, Temporal error, invalid input propagation)

---

## Hard Scope Boundaries

- **Language:** TypeScript only
- **Framework:** Jest + `@nestjs/testing` (`Test.createTestingModule`)
- **File naming:** `<feature>.component.spec.ts` (e.g. `handle-cron.component.spec.ts`)
- **Location:** `src/component-tests/` at the service root — never inside module subfolders
- **Allowed edits:** Files under `src/component-tests/`; source code only when fixing a real bug
- **Forbidden:** Infrastructure configs, `.env` files, or other services' source code

---

## The 2-Class Rule

For every entry point, ask:

> **Does this entry point call 2 or more internal service classes before reaching the external boundary?**

```
Controller → ServiceA → ServiceB → repo.save()
                         ↑
            2 internal classes → component test

Controller → ServiceA → repo.save()
              ↑
     1 internal class → unit test is enough
```

**Per-service checklist:**

1. List entry points (controllers, `@Cron`, Temporal activities, Redis/RabbitMQ consumers)
2. Trace call chain to the boundary
3. Count distinct internal service classes crossed
4. **≥ 2 classes of different modules** → component test; **1/2 class of same module** → unit test only ([unit-testing/SKILL.md](../unit-testing/SKILL.md))

| Entry point | Chain | Classes | Decision |
|---|---|---|---|
| `POST /bulk-discovery` | `JobConfigController` → `JobConfigService` → `WorkflowService` → Temporal | 3 | Component test |
| `GET /jobs` | `JobConfigController` → `JobConfigService` → repo | 2 | Unit test enough since both classes are of the same module (jobconfig) |
| `handleCron` | `WorkManagerService` → `AuthService` → HttpService + Worker.create | 3 | Component test |
| `validate` activity | `ValidateConnectionActivity` → `Protocols` → `NFSProtocol` → socket | 3 | Component test |
| `GET /workers` | `WorkersController` → `WorkersService` → repo | 2 | Unit test enough |
| `scheduleAJob` cron | `JobRunInitService` → `WorkflowService` + `MigrationConflictService` → Temporal | 3 | Component test |

**What a component test verifies** (not visible in unit tests):

- DTO transformation from controller through services
- Object shape passed between internal classes
- Error propagation back through the chain
- Arguments reaching `repo.save()`, `temporal.start()`, etc.

```
  test ──► Controller (REAL)
               ▼
           ServiceA (REAL)
               ▼
           ServiceB (REAL)
               ▼
           repo.save()  ◄── MOCKED (boundary)
```

Call the **real entry-point method** (controller/activity/cron) — do not bypass to a service directly.

---

## Before Writing

Confirm or gather:

- **Service name** — `worker`, `jobs-service`, `config-service`, etc.
- **Entry point** — exact method (cron, activity, controller route, consumer)
- **Real class chain** — classes to wire as real
- **Boundaries to mock** — DB repos, Temporal, Redis, HttpService, filesystem
- **Intent** — new file (`add-new`) or extend existing scenarios (`extend-existing`)

---

## Rules

1. **Read source first** — read every `.ts` file in the chain; never assume signatures or behavior.
2. **Read existing unit specs** — understand UT coverage and gaps before adding component scenarios.
3. **Wire real classes** — use real class names in `providers:[]`; no `useValue` mocks for internal services.
4. **Mock only boundaries** — `useValue` for repos (`getRepositoryToken`), Temporal client, Redis, external `HttpService`, `fs`.
5. **Override guards** — `.overrideGuard(JwtAuthGuard).useValue({ canActivate: () => true })` for HTTP tests.
6. **Static singletons** — instantiate manually before compile (e.g. `new WorkersConfig(mockConfigService)`).
7. **Scenario IDs** — happy paths `H1`, `H2`…; failures `N1`, `N2`…
8. **No infrastructure** — tests must pass with zero external services running.
9. **No UT duplication** — skip single-class happy paths already covered in `*.spec.ts`.
10. **Run after writing** — fix all failures before finishing (see [Running tests](#running-tests)).

---

## What to Mock

| Mock (boundary) | Keep real (in-service) |
|-----------------|------------------------|
| TypeORM repos (`getRepositoryToken`) | Controllers |
| Temporal client/worker | Service classes |
| Redis client | Internal utilities/helpers |
| External `HttpService` | Guards (override, don't mock) |
| `fs` / `fs/promises` | `ConfigService` (`useValue` with test map) |
| `child_process` | `LoggerFactory` (`useValue` with jest fns) |

---

## Test Module Patterns

### HTTP controller

```typescript
const module = await Test.createTestingModule({
  controllers: [RealController],
  providers: [
    RealServiceA,
    RealServiceB,
    { provide: getRepositoryToken(Entity), useValue: mockRepo() },
    { provide: TemporalClient, useValue: mockTemporal() },
    { provide: ConfigService, useValue: { get: jest.fn((k) => configMap[k]) } },
    { provide: LoggerFactory, useValue: mockLoggerFactory },
  ],
})
  .overrideGuard(JwtAuthGuard)
  .useValue({ canActivate: () => true })
  .compile();
```

### Temporal activity / cron (no controller)

```typescript
const module = await Test.createTestingModule({
  providers: [
    RealActivityService,
    RealHelperService,
    { provide: RedisService, useValue: mockRedis() },
    { provide: HttpService, useValue: mockHttp() },
    { provide: ConfigService, useValue: { get: jest.fn((k) => configMap[k]) } },
    { provide: LoggerFactory, useValue: mockLoggerFactory },
  ],
}).compile();
```

---

## Scenarios

For each entry point:

| ID | Purpose |
|----|---------|
| **H1** | Happy path — full chain succeeds end-to-end |
| **H2, H3…** | Alternative happy paths (input shapes, feature flags, protocol types) |
| **N1** | First boundary fails (DB throw, HTTP 500) |
| **N2** | Second boundary fails after first succeeds |
| **N3** | Invalid/missing input rejected mid-chain |
| **N4** | Partial failure — one path fails, others unaffected |
| **N5** | State reset after failure (e.g. `loadingConfigs = false`) |

Minimum: **H1** plus at least **N1** and **N2**.

---

## Workflow

1. **Discover the chain** — read entry point, trace classes, find boundary, read UT specs for gaps.
2. **Decide mocks** — use the table above.
3. **Write the module** — patterns above; read a reference implementation first.
4. **Write scenarios** — H1 + N1/N2 minimum.
5. **Run component tests** — fix failures; no skipped or commented-out tests.
6. **Run full package suite** — ensure no UT regressions.

---

## Service-Specific Notes

### worker

- `WorkersConfig` static singleton — `new WorkersConfig(mockConfigService)` before `compile()`
- `jest.mock('@temporalio/worker')` and `jest.mock('@temporalio/client')` at file top
- Mock `src/utils/temporal.utils` for cron/bootstrap tests
- Mock `fs/promises` when activities read config/version files
- `AuthService` is REAL in cron tests — mock Keycloak via `HttpService.post`

### jobs-service

- `.overrideGuard(JwtAuthGuard)` on all HTTP tests
- `WorkflowService` is real; mock only `@temporalio/client`
- `DataSource` — `useValue` with mocked `createQueryRunner`

### config-service / reports-service / support-service

- `WorkflowService` real; mock Temporal client only
- Activities: wire activity + helpers as real; no controller or guard

---

## Reference Implementations

<!-- | Service | File | Entry point | Real classes |
|---------|------|-------------|--------------|
| worker | `services/worker/src/component-tests/handle-cron.component.spec.ts` | `WorkManagerService.handleCron` | `WorkManagerService`, `AuthService` |
| worker | `services/worker/src/component-tests/validate.component.spec.ts` | `ValidateConnectionActivity.validate` | `ValidateConnectionActivity`, `Protocols`, `NFSProtocol`, `SMBProtocol` |
| worker | `services/worker/src/component-tests/list-path.component.spec.ts` | `ListPathActivity.listPath` | `ListPathActivity`, `Protocols`, `NFSProtocol`, `SMBProtocol` |
| jobs-service | `services/jobs-service/src/component-tests/bulk-discovery.component.spec.ts` | `JobConfigController.createBulkDiscovery` | `JobConfigController`, `JobConfigService`, `WorkflowService` |

Read the closest existing file before writing a new one. -->
 There are currently no checked-in reference component-test implementations listed in this repo. Before writing a new component test, look for existing `*.component.spec.ts` files in the target service and follow the conventions in this guide. If no such file exists yet, use the patterns above for wiring real in-service classes and mocking only outer boundaries.


---

## Running Tests

From the service package root (`services/<service-name>/`):

```bash
# Single component test file
npx jest --testPathPattern="component-tests/<filename>" --no-coverage --verbose

# Full package (verify no UT regressions)
npx jest --no-coverage
```

---

## Definition of Done

- [ ] File at `src/component-tests/<feature>.component.spec.ts`
- [ ] All in-service classes wired real; only boundaries mocked
- [ ] H1 passes end-to-end through the real entry point
- [ ] At least N1 and N2 cover boundary failures
- [ ] `npx jest --testPathPattern="component-tests/<filename>"` exits 0
- [ ] Full `npx jest` in the package still passes
- [ ] No source changes unless fixing a real bug
- [ ] Scenarios fill gaps UT cannot cover (multi-class contracts), not duplicate UT happy paths
