---
applyTo: "**/*.spec.ts,**/*.spec.tsx,**/*.test.ts,**/*.test.tsx,**/*_test.go,**/__tests__/**/*"
---

# Test-driven development (TDD)

Follow these rules when adding or changing tests and the code they exercise.

## Philosophy

- Tests must verify **behavior through public interfaces**, not implementation details. Code may change completely; tests should not need to.
- Prefer **integration-style** tests that exercise real code paths through public APIs. They describe _what_ the system does, not _how_.
- **Avoid** tests coupled to implementation: mocking internal collaborators, testing private methods, or asserting via back doors (e.g. raw DB queries) instead of the public interface. If refactoring without behavior change breaks a test, that test was tied to implementation.

## Anti-pattern: horizontal slices

Do **not** write all tests first, then all implementation. That yields tests for imagined behavior, brittle structure, and poor signal.

Use **vertical slices** (tracer bullets): one failing test → minimal code to pass → repeat. Each cycle learns from the last.

## Workflow

### 1. Planning

- Align names and vocabulary with the project domain; respect ADRs in the area you touch.
- Confirm which **public interface** changes are needed and which **behaviors** to test (you cannot test everything—prioritize critical paths and complex logic).
- Design for **testability** (dependencies injected, results returned, small surface area).
- Prefer **deep modules** (small interface, rich implementation) over shallow ones.

### 2. Tracer bullet

Write **one** test for **one** behavior: RED (fails) → GREEN (minimal pass). Proves the path end-to-end.

### 3. Incremental loop

For each further behavior: RED → GREEN. One test at a time; only enough code to pass; do not anticipate future tests; keep assertions about **observable** behavior.

### 4. Refactor

Only when **green**: remove duplication, deepen modules, apply SOLID where natural, run tests after each refactor step. **Never refactor while red.**

## Checklist per cycle

- [ ] Test describes behavior, not implementation
- [ ] Test uses the public interface only
- [ ] Test would survive an internal refactor
- [ ] Production code is minimal for the current test
- [ ] No speculative features

## Deep modules

A **deep module** has a small interface and substantial implementation inside; a **shallow module** exposes a large interface for thin logic—avoid that. Ask: fewer methods? simpler parameters? more complexity hidden behind the API?

## Interface design for testability

1. **Accept dependencies, do not create them** (inject gateways, clients, clocks)—so tests can substitute boundaries without patching internals.
2. **Return results; avoid unnecessary hidden side effects**—prefer outputs callers can assert.
3. **Keep surface area small**—fewer methods and parameters simplify tests.

## Good vs bad tests

**Good:** Assert outcomes callers care about through the public API; one main logical assertion; survives refactors.

**Bad:** Assert internal calls (`toHaveBeenCalled` on code you own), private methods, call order/count without a boundary reason, or state via DB/API back doors instead of the public API.

Prefer: verify through **createUser** then **getUser** by id, not by reading the DB directly.

## Mocking

Mock only at **system boundaries**: external HTTP/APIs, email, time/randomness, filesystem (when unavoidable), sometimes DB (prefer real test DB when feasible).

Do **not** mock your own modules/classes or internal collaborators you control.

At boundaries: use **dependency injection**; prefer **small, specific** client shapes (per operation) over one generic `fetch(endpoint)` so mocks stay simple and typed.

## Refactor candidates (after green)

Duplication; long methods (helpers behind public API); shallow modules; feature envy; primitive obsession; older code the new tests expose as problematic.
