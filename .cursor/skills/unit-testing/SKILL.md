---
name: ndm-unit-tests
description: Write unit tests for NDM TypeScript microservices and shared libraries (services/, lib/). Use when the user asks to write unit tests, add a *.spec.ts, test a service/controller/activity/util in isolation, mock dependencies, or decide whether a unit test is sufficient vs a component test. Also use when fixing failing Jest specs or improving test coverage for a single class.
---

# NDM Unit Testing

## Overview

Unit tests cover **one class or module** in isolation in `*.spec.ts` files colocated with source, with all collaborators mocked.

**Unit vs component vs E2E** (see [component-testing/SKILL.md](../component-testing/SKILL.md) for component tests):

| Level | Real code | Mocked |
|-------|-----------|--------|
| **Unit** | 1 class under test | All dependencies |
| **Component** | All classes inside one service | External boundaries only (DB, Temporal, Redis, HTTP) |
| **E2E** | Full stack | Nothing (real infra) — see [e2e-testing](../e2e-testing/SKILL.md) and [ui-testing](../ui-testing/SKILL.md) |

---

## When to Write a Unit Test

Apply the **2-class rule** from component-testing in reverse:

> If an entry point crosses **only one** internal service class before the external boundary, a **unit test is sufficient**. If it crosses **two or more**, add a component test (and keep unit tests for each class).

**Always write unit tests for:**

- Pure functions and utilities (`utils.spec.ts` — no NestJS module)
- A single service class's business logic
- A controller's HTTP mapping (delegate to mocked service)
- An activity/helper class in isolation
- Shared library code in `lib/`
- Error paths and edge cases for one class

**Do not use unit tests to verify:**

- DTO shape passed between two internal services
- Error propagation across multiple real service classes
- Full cron/activity/controller chains (→ component test)

---

## Hard Scope Boundaries

- **Language:** TypeScript only
- **Framework:** Jest + `@nestjs/testing` for NestJS classes; plain Jest for pure functions
- **File naming:** `<source-file>.spec.ts` colocated with the source (e.g. `workers.service.spec.ts` next to `workers.service.ts`)
- **Test regex:** `.*\.spec\.ts$` (configured in each package's `package.json` → `jest`)
- **Excluded from unit runs:** `src/component-tests/`, `test/`, `entities/`, `config/`, `*.module.ts`
- **Allowed edits:** The spec file and, only if required, the source under test when a real bug is found
- **Forbidden:** Changes to infrastructure, `.env`, or other services' source to make tests pass

---

## File Layout and Structure

### Colocation

```
src/workers/workers.service.ts
src/workers/workers.service.spec.ts   ← same folder
```

Component tests live separately: `src/component-tests/<feature>.component.spec.ts`.

### Standard skeleton (NestJS class)

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { ClassUnderTest } from './class-under-test';

describe('ClassUnderTest', () => {
  let sut: ClassUnderTest;           // system under test
  let dependency: jest.Mocked<Dep>;  // typed when helpful

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClassUnderTest,              // REAL — always the class under test
        { provide: Dep, useValue: { method: jest.fn() } },
      ],
    }).compile();

    sut = module.get(ClassUnderTest);
    dependency = module.get(Dep);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(sut).toBeDefined();
  });

  describe('methodName', () => {
    it('should <observable behavior>', async () => {
      // arrange → act → assert
    });
  });
});
```

### Pure function / util (no NestJS)

```typescript
import { generateWorkerName } from './utils';

describe('generateWorkerName', () => {
  it('should return nfs-worker prefix for LINUX platform', () => {
    expect(generateWorkerName(1, Platform.LINUX)).toBe('nfs-worker-1');
  });
});
```

No `Test.createTestingModule` — import and call directly.

---

## Patterns by Test Type

### Service unit test

- **Real:** the service class
- **Mock:** TypeORM repos (`getRepositoryToken`), `ConfigService`, `HttpService`, other services, `LoggerFactory`

```typescript
providers: [
  WorkersService,
  {
    provide: getRepositoryToken(WorkerEntity),
    useValue: { find: jest.fn(), count: jest.fn() },
  },
  {
    provide: ConfigService,
    useValue: { get: jest.fn() },
  },
  {
    provide: LoggerFactory,
    useValue: {
      create: jest.fn().mockReturnValue({
        log: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn(),
      }),
    },
  },
],
```

Assert **return values and thrown errors**, and verify boundary mocks (`repository.find`) received expected arguments — not internal private methods.

Reference: `services/jobs-service/src/workers/workers.service.spec.ts`, `services/jobs-service/src/migration-conflict/migration-conflict.service.spec.ts`

### Controller unit test

- **Real:** the controller
- **Mock:** every injected service (`useValue` with `jest.fn()` per public method), `JwtService`, `LoggerFactory`

```typescript
controllers: [WorkersController],
providers: [
  {
    provide: WorkersService,
    useValue: { findAllWorkers: jest.fn(), updateWorkerJobRunStatus: jest.fn() },
  },
  { provide: JwtService, useValue: mockJwtService },
],
```

Test: controller calls service with correct args; controller returns/forwards service result; errors propagate.

Reference: `services/jobs-service/src/workers/workers.controller.spec.ts`, `services/jobs-service/src/jobrun/jobrun.controller.spec.ts`

### Activity / worker service unit test

- **Real:** the activity class
- **Mock:** `Protocols`, `ConfigService`, `LoggerFactory`, Redis/Http boundaries

Use `jest.mock('src/protocols/protocols')` only when the module constructs collaborators internally; prefer `useValue` injection when Nest provides the dependency.

Reference: `services/worker/src/activities/list-path/list-path.service.spec.ts`

### External module boundary (`jest.mock`)

Use at file top when the SUT imports a module directly (not via DI):

```typescript
jest.mock('redis', () => ({ createClient: jest.fn() }));
```

Restore env vars and clear mocks in `afterEach`. Reference: `lib/jobs-lib/src/redis/redis-utils.spec.ts`

### Temporal workflow unit test

Workflow specs use `@temporalio/testing` (`TestWorkflowEnvironment`, time-skipping worker). Activities are **always mocked** — this is still a unit test of workflow orchestration, not activity implementation.

Reference: `services/worker/src/workflows/validate-connection/validate-worker-connection.workflow.spec.ts`

---

## Mocking Rules

Follow [mocking.md](mocking.md) (adapted from TDD skill). Summary:

| Mock | Don't mock |
|------|------------|
| TypeORM repositories | The class under test |
| `HttpService`, Redis client, Temporal client | Your own service classes (in UT) |
| `ConfigService`, `LoggerFactory` | Internal helpers the SUT owns |
| Other services injected into the SUT | — |

**ConfigService:** use a `configMap` or `switch` in `get: jest.fn((key) => configMap[key])`.

**HttpService (RxJS):** return Observables, not Promises:

```typescript
import { of, throwError } from 'rxjs';
jest.spyOn(httpService, 'post').mockReturnValue(of({ data: token } as AxiosResponse));
jest.spyOn(httpService, 'post').mockReturnValue(throwError(() => new Error('fail')));
```

**LoggerFactory:** always provide; assert on `mockLogger.log` / `error` only when logging is part of the behavior under test.

**Shared mocks:** export reusable `mockLogger` / `mockLoggerFactory` from a spec only when multiple specs in the same service import them (e.g. `services/worker/src/auth/auth.service.spec.ts`). Do not create cross-service imports.

---

## Test Design (from TDD)

1. **Test behavior, not implementation** — name tests after observable outcomes: `should return empty array when no conflicts found`, not `should call repository.find`.
2. **Public interface only** — never test private methods; refactor-safe tests survive internal changes.
3. **Arrange → Act → Assert** — one logical behavior per `it`; avoid multiple unrelated assertions.
4. **Vertical slices when adding features** — one test → minimal code → next test. Do not bulk-write tests then bulk-write implementation ([tdd/SKILL.md](../tdd/SKILL.md)).
5. **Prioritize** — critical paths and complex logic first; confirm with user if scope is large.
6. **Document domain language** — for complex domains, add a short file-level comment explaining test conventions (see `migration-conflict.service.spec.ts`).
7. **Edge cases** — empty inputs, not-found, boundary failures, invalid enums; use `@ts-expect-error` sparingly for impossible types.
8. **Timers** — `jest.useFakeTimers()` in `beforeEach`, `jest.useRealTimers()` in `afterEach` when testing delays/retries.

### Red flags (bad tests)

- Mocking the class under test
- Asserting call order of internal methods with no behavioral reason
- Test breaks on rename/refactor but behavior unchanged
- Duplicating component-test scenarios (multi-class chains) in unit tests
- Querying real DB/Redis/Temporal in unit tests

---

## Naming Conventions

| Element | Convention | Example |
|---------|------------|---------|
| File | `<name>.spec.ts` | `workers.service.spec.ts` |
| Top `describe` | Class or function name | `describe('WorkersService', ...)` |
| Nested `describe` | Method name | `describe('findAllWorkers', ...)` |
| `it` | `should <behavior>` | `should return paginated data with count` |
| Variables | `sut` or service name | `let service: WorkersService` |

---

## Running Tests

From the service or lib package root:

```bash
# Single file
npx jest --testPathPattern="workers.service.spec" --no-coverage --verbose

# All unit tests in package
npx jest --no-coverage

# Watch mode
npm run test:watch
```

Always run the affected spec after writing or changing tests. Fix all failures before finishing.

`moduleNameMapper` maps `src/` → `<rootDir>/src/` — use `src/...` imports consistent with the service.

---

## Reference Implementations

| Type | File |
|------|------|
| Service + TypeORM | `services/jobs-service/src/workers/workers.service.spec.ts` |
| Controller | `services/jobs-service/src/jobrun/jobrun.controller.spec.ts` |
| Complex domain logic | `services/jobs-service/src/migration-conflict/migration-conflict.service.spec.ts` |
| Pure util | `services/config-service/src/util/utils.spec.ts` |
| Activity | `services/worker/src/activities/list-path/list-path.service.spec.ts` |
| HttpService + timers | `services/jobs-service/src/auth/auth.service.spec.ts` |
| `jest.mock` boundary | `lib/jobs-lib/src/redis/redis-utils.spec.ts` |
| Temporal workflow | `services/worker/src/workflows/validate-connection/validate-worker-connection.workflow.spec.ts` |

Read the closest existing spec before writing a new one — match its module setup and assertion style.

---

## Workflow Checklist

1. Read the **source file** under test — confirm public methods and dependencies.
2. Read an **existing spec** in the same service for patterns.
3. Decide **unit vs component** (2-class rule).
4. Create/update `<name>.spec.ts` colocated with source.
5. Wire `Test.createTestingModule` — real SUT, mocked deps.
6. Write scenarios: happy path, primary errors, important edge cases.
7. Run `npx jest --testPathPattern="<filename>" --no-coverage --verbose`.
8. Run full package `npx jest --no-coverage` if changes could affect other specs.

---

## Definition of Done

- [ ] Spec file colocated as `<source>.spec.ts`
- [ ] Exactly one real class (or pure function) under test
- [ ] All dependencies mocked at injection boundary
- [ ] Tests describe observable behavior with `should ...` names
- [ ] `npx jest --testPathPattern="<file>"` exits 0
- [ ] No duplicate coverage of multi-class flows (left to component tests)
- [ ] No product source changes unless fixing a real bug
