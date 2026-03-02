# Copilot Code Review Instructions — TypeScript

These instructions guide GitHub Copilot when reviewing TypeScript code in this repository.
Apply these rules consistently across **all pull requests**.

> **Legend:**
> - ❌ = Pattern to flag / reject
> - ✅ = Preferred pattern to suggest

---

## Table of Contents

- [Copilot Code Review Instructions — TypeScript](#copilot-code-review-instructions--typescript)
  - [Table of Contents](#table-of-contents)
  - [1. Type Safety](#1-type-safety)
  - [2. Interfaces \& Types](#2-interfaces--types)
  - [3. Null \& Undefined Handling](#3-null--undefined-handling)
  - [4. Async / Await \& Promises](#4-async--await--promises)
  - [5. Avoid Synchronous Methods](#5-avoid-synchronous-methods)
    - [5.1 File System (`fs`)](#51-file-system-fs)
    - [5.2 Child Process](#52-child-process)
    - [5.3 DNS](#53-dns)
    - [5.4 Acceptable Exceptions](#54-acceptable-exceptions)
  - [6. Generics](#6-generics)
  - [7. Enums](#7-enums)
  - [8. Functions \& Methods](#8-functions--methods)
  - [9. Classes](#9-classes)
  - [10. Readonly \& Immutability](#10-readonly--immutability)
  - [11. Error Handling](#11-error-handling)
  - [12. Imports \& Modules](#12-imports--modules)
  - [13. Utility Types](#13-utility-types)
  - [14. Naming Conventions](#14-naming-conventions)
  - [15. Comments \& Documentation](#15-comments--documentation)
  - [16. Testing Considerations](#16-testing-considerations)
  - [17. Performance](#17-performance)
  - [18. Security](#18-security)
  - [19. General Review Checklist](#19-general-review-checklist)
    - [Type Safety](#type-safety)
    - [Async \& I/O](#async--io)
    - [Code Quality](#code-quality)
    - [Documentation \& Tests](#documentation--tests)
    - [Security](#security)

---

## 1. Type Safety

- **Never use `any`** — flag all occurrences. Suggest a specific type, `unknown`, or a generic.
- **No implicit `any`** — all function parameters and return types must be explicitly typed.
- **Prefer `unknown` over `any`** for truly unknown values; always narrow before use.
- **Avoid type assertions (`as`)** unless unavoidable. Require an explanatory comment when used.
- **Enforce strict null checks** — flag patterns that ignore `null` or `undefined`.

```ts
// ❌ Bad
function process(data: any) { ... }

// ✅ Good
function process(data: ProcessInput): ProcessOutput { ... }
```

---

## 2. Interfaces & Types

- Use `interface` for object shapes that may be extended; use `type` for unions, intersections, and aliases.
- Avoid redundant or overlapping type declarations.
- All exported types and interfaces must have JSDoc comments.
- Flag `object`, `Object`, or `{}` as types — require specific, named definitions.

```ts
// ❌ Bad
const handler = (req: object) => { ... }

// ✅ Good
const handler = (req: Request): Response => { ... }
```

---

## 3. Null & Undefined Handling

- Flag unguarded access on values that may be `null` or `undefined`.
- Suggest optional chaining (`?.`) and nullish coalescing (`??`) where appropriate.
- Flag non-null assertions (`!`) unless provably safe — require a comment explaining why.

```ts
// ❌ Bad
const name = user.profile.name;

// ✅ Good
const name = user?.profile?.name ?? 'Anonymous';
```

---

## 4. Async / Await & Promises

- All `async` functions must declare an explicit return type (e.g., `Promise<User>`).
- Prefer `async/await` over `.then()/.catch()` chains for consistency and readability.
- All `await` expressions must be inside a `try/catch` or have upstream error handling.
- Flag unhandled floating promises (no `await` and no `.catch()`).

```ts
// ❌ Bad
fetchUser().then(u => setUser(u));

// ✅ Good
try {
  const user = await fetchUser();
  setUser(user);
} catch (error: unknown) {
  handleError(error);
}
```

---

## 5. Avoid Synchronous Methods

> **Rule:** Never use synchronous (blocking) API variants when an async alternative exists.
> Sync methods block the Node.js event loop and harm performance in server-side and I/O-heavy code.

### 5.1 File System (`fs`)

Always use `fs/promises` (or `fs.promises.*`) instead of `*Sync` methods.

| ❌ Sync (forbidden)        | ✅ Async alternative         |
|---------------------------|------------------------------|
| `fs.readFileSync()`       | `fs.promises.readFile()`     |
| `fs.writeFileSync()`      | `fs.promises.writeFile()`    |
| `fs.mkdirSync()`          | `fs.promises.mkdir()`        |
| `fs.mkdtempSync()`        | `fs.promises.mkdtemp()`      |
| `fs.readdirSync()`        | `fs.promises.readdir()`      |
| `fs.statSync()`           | `fs.promises.stat()`         |
| `fs.renameSync()`         | `fs.promises.rename()`       |
| `fs.unlinkSync()`         | `fs.promises.unlink()`       |
| `fs.copyFileSync()`       | `fs.promises.copyFile()`     |
| `fs.existsSync()`         | `fs.promises.access()`       |
| `fs.appendFileSync()`     | `fs.promises.appendFile()`   |
| `fs.chmodSync()`          | `fs.promises.chmod()`        |
| `fs.lstatSync()`          | `fs.promises.lstat()`        |
| `fs.realpathSync()`       | `fs.promises.realpath()`     |
| `fs.truncateSync()`       | `fs.promises.truncate()`     |

```ts
// ❌ Bad — blocks the event loop
import fs from 'fs';

const data = fs.readFileSync('./config.json', 'utf-8');
fs.writeFileSync('./output.json', data);
fs.mkdirSync('./logs', { recursive: true });

// ✅ Good — non-blocking
import fs from 'fs/promises';

const data = await fs.readFile('./config.json', 'utf-8');
await fs.writeFile('./output.json', data);
await fs.mkdir('./logs', { recursive: true });
```

### 5.2 Child Process

Flag `execSync`, `spawnSync`, and `execFileSync`. Use promisified alternatives instead.

```ts
// ❌ Bad
import { execSync } from 'child_process';
const result = execSync('ls -la').toString();

// ✅ Good
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const { stdout } = await execAsync('ls -la');
```

### 5.3 DNS

Flag synchronous DNS lookups. Use `dns.promises.*` instead.

```ts
// ❌ Bad
import dns from 'dns';
dns.lookupSync('example.com');

// ✅ Good
import dns from 'dns/promises';
const address = await dns.lookup('example.com');
```

### 5.4 Acceptable Exceptions

The following are the **only** acceptable uses of sync methods.
Always add a comment explaining the exception:

| Scenario                        | Reason sync is acceptable                         |
|---------------------------------|---------------------------------------------------|
| Top-level CLI scripts           | Single-run process; event loop not a concern      |
| Jest/Vitest `globalSetup` files | Test runner does not support async in setup files |
| Build tooling (`scripts/*.ts`)  | Not part of the application runtime               |

```ts
// OK: CLI entry point — single-run process, blocking I/O is acceptable here
const config = fs.readFileSync('./config.json', 'utf-8');
```

---

## 6. Generics

- Encourage generics over duplicated typed functions.
- Use descriptive generic parameter names (`TItem`, `TResponse`) in complex contexts.
- Flag overly broad or unconstrained generics where a `extends` constraint would improve safety.

```ts
// ❌ Bad
function getFirst(arr: string[]): string { ... }
function getFirst(arr: number[]): number { ... }

// ✅ Good
function getFirst<T>(arr: T[]): T | undefined { ... }
```

---

## 7. Enums

- Prefer `const enum` for compile-time inlining when runtime reflection is not needed.
- Always use string enums over numeric enums for clarity and debuggability.
- Flag mixing `enum` and union string types for the same concept.

```ts
// ❌ Bad
enum Direction { Up, Down, Left, Right }

// ✅ Good
const enum Direction {
  Up    = 'UP',
  Down  = 'DOWN',
  Left  = 'LEFT',
  Right = 'RIGHT',
}
```

---

## 8. Functions & Methods

- All exported functions must have explicit parameter types and return types.
- Flag functions longer than ~40 lines — suggest decomposition into smaller units.
- Prefer pure functions; flag side effects that are not clearly documented.
- Avoid overloaded function signatures unless they meaningfully improve clarity.

---

## 9. Classes

- Enforce access modifiers (`private`, `protected`, `public`) on **all** class members.
- Flag mutable public class properties — prefer `readonly` or accessor methods.
- Avoid `this` outside of class methods; ensure correct binding contexts.
- Prefer composition over inheritance; flag inheritance chains deeper than 2 levels.

```ts
// ❌ Bad
class User {
  name: string;
  age: number;
}

// ✅ Good
class User {
  constructor(
    public  readonly name: string,
    private          age: number,
  ) {}
}
```

---

## 10. Readonly & Immutability

- Use `readonly` on class properties and interface fields that must not change after initialization.
- Prefer `Readonly<T>`, `ReadonlyArray<T>`, or `as const` for immutable data structures.
- Flag direct mutation of function arguments.

```ts
// ❌ Bad
function updateUser(user: User) {
  user.name = 'Updated'; // mutates caller's object
}

// ✅ Good
function updateUser(user: Readonly<User>): User {
  return { ...user, name: 'Updated' };
}
```

---

## 11. Error Handling

- `catch` blocks must never be empty — at minimum, log the error.
- Never catch an `Error` and re-throw it as a plain string.
- Use custom error classes that extend `Error` for domain-specific errors.
- Flag `catch (e: any)` — use `catch (e: unknown)` and narrow the type before use.

```ts
// ❌ Bad
try { ... } catch (e) {}

// ✅ Good
try {
  ...
} catch (e: unknown) {
  if (e instanceof AppError) {
    logger.error(e.message);
  } else {
    throw e;
  }
}
```

---

## 12. Imports & Modules

- Prefer named exports over default exports for better refactoring tooling support.
- Flag unused imports.
- Use absolute imports via `paths` in `tsconfig.json` — flag deep relative paths (`../../..`).
- Use `import type` for type-only imports to prevent accidental runtime inclusion.

```ts
// ❌ Bad
import UserService from '../../services/UserService';
import { User } from '../../models/User';

// ✅ Good
import { UserService } from '@services/UserService';
import type { User } from '@models/User';
```

---

## 13. Utility Types

Encourage use of built-in TypeScript utility types. Flag manual re-implementations.

| Utility Type              | Use case                                     |
|---------------------------|----------------------------------------------|
| `Partial<T>`              | All properties optional                      |
| `Required<T>`             | All properties required                      |
| `Pick<T, K>`              | Select a subset of properties                |
| `Omit<T, K>`              | Exclude specific properties                  |
| `Record<K, V>`            | Key-value map with typed keys and values     |
| `ReturnType<T>`           | Infer function return type                   |
| `Parameters<T>`           | Infer function parameter types               |
| `Awaited<T>`              | Unwrap resolved Promise type                 |
| `Readonly<T>`             | Make all properties readonly                 |
| `NonNullable<T>`          | Exclude null and undefined                   |

```ts
// ❌ Bad
type UserUpdate = {
  name?: string;
  email?: string;
};

// ✅ Good
type UserUpdate = Partial<Pick<User, 'name' | 'email'>>;
```

---

## 14. Naming Conventions

| Construct          | Convention               | Example                     |
|-------------------|--------------------------|-----------------------------|
| Variables          | `camelCase`              | `userCount`                 |
| Functions          | `camelCase`              | `getUserById`               |
| Classes            | `PascalCase`             | `UserService`               |
| Interfaces         | `PascalCase` (no `I` prefix) | `UserProfile`           |
| Type aliases       | `PascalCase`             | `ApiResponse`               |
| Enums              | `PascalCase`             | `OrderStatus`               |
| Constants          | `SCREAMING_SNAKE_CASE`   | `MAX_RETRY_COUNT`           |
| Generic parameters | `T`, `TKey`, `TValue`    | `function get<TItem>()`     |
| Test files         | `*.test.ts` / `*.spec.ts`| `userService.test.ts`       |

---

## 15. Comments & Documentation

- All exported symbols (functions, classes, types, constants) must have JSDoc comments.
- Inline comments should explain **why**, not **what** — the code should speak for itself.
- Flag `TODO` and `FIXME` comments that do not reference a tracked issue number.

```ts
// ❌ Bad
// TODO: fix this later

// ✅ Good
// TODO(#234): Retry logic missing — handle transient network failures
```

---

## 16. Testing Considerations

- Flag new logic that has no corresponding test file or test case.
- Test files must use `.test.ts` or `.spec.ts` naming suffix.
- Use TypeScript-safe mocking (e.g., `jest.Mocked<T>`, `vi.mocked()`).
- Flag `as any` casts inside test files — use properly typed mocks or fixtures.

```ts
// ❌ Bad
const mockService = { getUser: jest.fn() } as any;

// ✅ Good
const mockService = { getUser: jest.fn() } as jest.Mocked<UserService>;
```

---

## 17. Performance

- Flag synchronous operations inside loops that could be parallelized with `Promise.all`.
- Flag unnecessary re-computation inside render functions or hot paths — suggest memoization.
- Avoid using the `delete` operator on object properties — prefer `undefined` assignment or `Omit<T, K>`.

```ts
// ❌ Bad — sequential, slow
for (const id of userIds) {
  await fetchUser(id);
}

// ✅ Good — parallel
await Promise.all(userIds.map(id => fetchUser(id)));
```

---

## 18. Security

- Flag string interpolation in SQL queries or shell commands — require parameterized inputs.
- Flag hardcoded secrets, API keys, tokens, or credentials of any kind.
- Flag missing validation on user-supplied or external input before it is used.
- Flag use of `eval()`, `Function()`, or `new Function()` — these are unsafe.

```ts
// ❌ Bad
const query = `SELECT * FROM users WHERE id = ${userId}`;

// ✅ Good
const query = 'SELECT * FROM users WHERE id = ?';
db.execute(query, [userId]);
```

---

## 19. General Review Checklist

Before approving any pull request, verify all of the following:

### Type Safety
- [ ] No `any` types without a justified, commented reason
- [ ] All exported functions have explicit parameter and return types
- [ ] No unsafe non-null assertions (`!`) without explanation

### Async & I/O
- [ ] No `*Sync` file system, child process, or DNS methods in application code
- [ ] All async code handles errors with `try/catch`
- [ ] No unhandled floating promises

### Code Quality
- [ ] No functions longer than ~40 lines without decomposition
- [ ] Naming conventions are followed throughout
- [ ] No unused imports or variables
- [ ] Deep relative imports replaced with absolute path aliases

### Documentation & Tests
- [ ] All exported symbols have JSDoc comments
- [ ] No `TODO`/`FIXME` without a linked issue number
- [ ] New logic has corresponding test coverage
- [ ] No `as any` casts in test files

### Security
- [ ] No hardcoded secrets or credentials
- [ ] User input is validated before use
- [ ] No raw string interpolation in SQL or shell commands