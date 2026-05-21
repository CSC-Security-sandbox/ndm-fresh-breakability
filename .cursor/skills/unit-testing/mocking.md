# Unit Test Mocking (NDM)

Detailed mocking guidance for NDM unit tests. See [SKILL.md](SKILL.md) for structure and workflow.

## Principle

Mock at **system boundaries** only. In a unit test, every collaborator of the class under test is a boundary.

## Always Mock in Unit Tests

| Dependency | Pattern |
|------------|---------|
| TypeORM `Repository` | `{ provide: getRepositoryToken(Entity), useValue: { find: jest.fn(), save: jest.fn(), ... } }` |
| Custom repository | `{ provide: SoftDeleteJobConfigRepository, useValue: { find: jest.fn(), ... } }` |
| `ConfigService` | `{ provide: ConfigService, useValue: { get: jest.fn((k) => configMap[k]) } }` |
| `LoggerFactory` | `{ create: jest.fn().mockReturnValue({ log, error, warn, debug: jest.fn() }) }` |
| `HttpService` | `{ post: jest.fn(), get: jest.fn() }` + RxJS `of` / `throwError` |
| Other Nest services | `{ provide: XService, useValue: { publicMethod: jest.fn() } }` |
| `JwtService` | Minimal mock with `verifyToken: jest.fn().mockResolvedValue({ user: { roles: [...] } })` |
| Redis / Temporal / fs | `useValue` or top-level `jest.mock('module')` |

## Never Mock in Unit Tests

- The class under test (SUT)
- Internal private methods (test through public API)
- Other classes in the same service that the SUT calls directly — if you need them real, that's a **component test**

## ConfigService Patterns

**Map lookup (preferred for many keys):**

```typescript
const configMap: Record<string, unknown> = {
  KEYCLOAK_BASE_URL: 'http://keycloak.test',
  'worker.workerId': 'test-worker-id',
};
{ provide: ConfigService, useValue: { get: jest.fn((key: string) => configMap[key]) } }
```

**Switch (few keys):**

```typescript
get: jest.fn((key: string) => {
  switch (key) {
    case 'keycloak': return mockKeycloakConfig;
    case 'worker.workerId': return 'test-id';
  }
}),
```

## TypeORM Repository

Declare mock fns once, reuse across tests:

```typescript
const mockRepo = {
  find: jest.fn(),
  findOne: jest.fn(),
  save: jest.fn(),
};

beforeEach(async () => {
  const module = await Test.createTestingModule({
    providers: [
      MyService,
      { provide: getRepositoryToken(MyEntity), useValue: mockRepo },
    ],
  }).compile();
});

afterEach(() => jest.clearAllMocks());

it('should query with expected filters', async () => {
  mockRepo.find.mockResolvedValue([]);
  await service.loadAll(dto);
  expect(mockRepo.find).toHaveBeenCalledWith({ where: { status: dto.status } });
});
```

## HttpService (Axios / RxJS)

Nest `HttpService` returns Observables:

```typescript
import { of, throwError } from 'rxjs';
import { AxiosResponse } from 'axios';

const response = { data: { access_token: 'tok' }, status: 200 } as AxiosResponse;
jest.spyOn(httpService, 'post').mockReturnValue(of(response));
jest.spyOn(httpService, 'post').mockReturnValue(throwError(() => new Error('Network error')));
```

## jest.mock vs useValue

| Use `useValue` in TestingModule | Use `jest.mock` at file top |
|--------------------------------|-----------------------------|
| Class receives dep via constructor/`@Inject` | Module imported directly (`import { createClient } from 'redis'`) |
| Nest DI manages the dependency | Static/singleton construction outside DI |

After `jest.mock`, reset in `afterEach`:

```typescript
afterEach(() => {
  jest.clearAllMocks();
  delete process.env.REDIS_HOST; // if env was set in test
});
```

## Anti-Patterns

```typescript
// BAD: mock the SUT
{ provide: WorkersService, useValue: { findAllWorkers: jest.fn() } }

// BAD: over-specify internal call order
expect(service['helper'].format).toHaveBeenCalledBefore(service['helper'].send);

// BAD: conditional logic inside a generic mock
mockHttp.fetch.mockImplementation((url) => {
  if (url.includes('/users')) return users;
  if (url.includes('/orders')) return orders;
});
// GOOD: separate jest.fn() per endpoint method on useValue
```

## Designing for Testability

Prefer constructor injection over `new ExternalClient()` inside methods. Specific service methods are easier to mock than one generic `fetch(url, options)`.
