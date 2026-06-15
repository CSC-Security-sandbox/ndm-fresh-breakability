---
name: admin-service-audit-validation
description: >-
  Validate admin-service code against the P0/P1 audit findings to prevent regressions.
  Use when modifying files in services/admin-service/src/ — especially auth, project,
  user-role, permission, setting, upgrade, email, or workflow modules. Also use when
  reviewing PRs that touch the admin-service.
---

# Admin Service Audit Validation

When modifying `services/admin-service/src/`, validate that the following invariants
are preserved. If a change violates any rule, flag it as a regression.

## P0 Reliability Rules

### R1: Keycloak-before-DB ordering in setUserStatus
- `auth/auth.service.ts` `setUserStatus` must call Keycloak **before** updating the DB.
- The DB write (`userRepository.save`) must be inside the try block, **after** the Keycloak PUT succeeds.
- If Keycloak fails, the DB must remain unchanged.

### R2: Compensating cleanup in inviteUser
- `auth/auth.service.ts` `inviteUser` must delete the Keycloak user if `userRepository.save` fails.
- The cleanup lives in a nested try/catch around the DB save.
- Never remove or disable this compensating action.

### R3: Transaction on batch user-role replacement
- `user-role/user-role.service.ts` `batchCreate` must wrap delete + insert in `dataSource.transaction()`.
- The delete and save must use the same transaction `manager`, not the repository directly.

### R4: Awaited DB updates in upload error handlers
- `upgrade/upgrade.service.ts` chunk upload error/abort handlers must `await` the DB status update.
- Never use fire-and-forget `.catch(log)` for status transitions.

### R5: Auth on email endpoints
- `email/email.controller.ts` must have `@Auth()` on both `/external` and `/internal`.
- Never remove authentication from these endpoints.

## P0 Data Integrity Rules

### DI1: Project name uniqueness (race-safe)
- `entities/project.entity.ts` must have `@Unique` on `(account, project_name)`.
- `project/project.service.ts` `create` must catch PostgreSQL error code `23505` and throw `ConflictException`.

### DI2: User email uniqueness (race-safe)
- `entities/user.entity.ts` must have `unique: true` on the `email` column.
- `auth/auth.service.ts` `inviteUser` must catch `23505` and throw `ConflictException`.

### DI3: Setting key uniqueness via upsert
- `setting/setting.service.ts` `create` must use `settingsRepo.upsert()` with `conflictPaths: ['settingKey']`.
- Never revert to the per-key find-then-save pattern.

### DI4: Existence checks on permission mutations
- `permission/permission.service.ts` `update`, `delete`, `inactivate` must verify the entity exists before mutating.
- Throw `NotFoundException` if not found.

### DI5: Existence check on project update
- `project/project.service.ts` `update` must verify the project exists before calling `projectRepository.update`.

## P0 Performance Rules

### P1/P2: No N+1 in project list endpoints
- `project/project.service.ts` `findAll` and `findByAccount` must bulk-fetch users with `In(userIds)`.
- Never use per-project `findOne` for `created_by`/`updated_by`.

### P3: Batch setting operations
- `setting/setting.service.ts` `updateSetting` must batch-fetch with `In(keys)` then batch-save.
- Never use a sequential per-key `findOne` + `save` loop.

## P0 Scalability Rules

### S1: Paginated role findAll
- `role/role.service.ts` `findAll` must have `skip`/`take` parameters.

### S2: Safety limit on permission findAll
- `permission/permission.service.ts` `findAll` must include `take: 1000` (or pagination).

### S3: Safety limit on about-ndm worker fetch
- `about-ndm/about-ndm.service.ts` worker query must include `take: 1000`.

### S4: Safety limit on settings findAll
- `setting/setting.service.ts` `findAll` must include `take: 1000`.

### S5: Bulk update for orphaned uploads
- `upgrade/upgrade.service.ts` `cleanupOrphanedUploads` must use `In(ids)` bulk update, not a sequential loop.

### S6: Limit on user-role query by project
- `user/user.service.ts` user-role query must include a `take` limit.

## P1 Reliability Rules

### R4: Guarded JSON.parse in controllers
- All controllers that accept a `filter` query param must wrap `JSON.parse(filter)` in try/catch.
- Throw `BadRequestException('Invalid filter JSON')` on parse failure.

### R5: Error handler on download stream
- `upgrade/upgrade.controller.ts` bundle download must have `.on('error', ...)` on the stream before piping.

### R6: Poller circuit breaker
- `upgrade/upgrade.service.ts` poller must track consecutive failures and stop after N failures.

### R7: try/catch on Temporal calls
- `workflow/workflow.service.ts` must wrap `handle.describe()`/`result()`/`terminate()` in try/catch.

## P1 Data Integrity Rules

### DI4: ValidationPipe configuration
- `main.ts` must configure `ValidationPipe` with `{ transform: true, whitelist: true, forbidNonWhitelisted: true }`.

### DI5: Auth DTO validation
- `auth/auth.controller.ts` DTOs must have `class-validator` decorators (`@IsEmail`, `@IsString`, `@IsBoolean`, etc.).

### DI6: No password in response
- `auth/auth.controller.ts` `resetPassword` must NOT return the password (encrypted or otherwise) in the response body.

### DI7: HttpCode preserved by interceptor
- `lib/api-handler-lib` `ResponseInterceptor` must use `Reflector` to read `@HttpCode()` metadata and preserve it.

## P1 Performance Rules

### P1: Parallel lookups in role-permission update
- `role-permission/role-permission.service.ts` `update` must use `Promise.all` for independent lookups.

### P2: Parallel lookups in user-role create/update
- `user-role/user-role.service.ts` `create`/`update` must use `Promise.all` for independent lookups.

## P1 Scalability Rules

### S2: Total count in list endpoints
- `project.service`, `user.service`, `user-role.service` `findAll` must use `findAndCount` and return `{ data, total, page, limit }`.

### S3: Limits on worker queries in upgrade
- All `workerRepository.find()` calls in `upgrade/upgrade.service.ts` must include a `take` limit.

## Cross-Cutting Rules

### Rate limiting
- `app.module.ts` must import `ThrottlerModule` and provide `ThrottlerGuard` as `APP_GUARD`.

### Response caching
- `about-ndm`, `roles`, and `permissions` GET endpoints should use `@UseInterceptors(CacheInterceptor)`.

---

## How to Validate

When reviewing a change to admin-service:

1. Identify which files are modified.
2. Check the rules above that apply to those files.
3. If any rule is violated, flag it with the finding ID (e.g., "This reverts P0-R3: the delete+insert must be inside a transaction").
4. If adding new multi-step operations, check whether they need a transaction or compensating action.
5. If adding new list endpoints, ensure they have pagination (`skip`/`take`) and return a `total` count.
6. If adding new external API calls (Keycloak, Temporal), ensure they have try/catch with structured error responses.
