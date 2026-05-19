# NDM Unit Test — Detailed Reference

This file supplements the main `SKILL.md` with service-level deep dives,
additional mock patterns, and worked examples from the actual NDM codebase.

---

## Service Map — Source Files and Their Tests

### admin-service (`services/admin-service/`)

| Source | Spec | Key Methods to Test |
|--------|------|---------------------|
| `src/auth/auth.service.ts` | `auth.service.spec.ts` | `validateToken`, `getKeycloakAdminToken` |
| `src/user/user.service.ts` | `user.service.spec.ts` | `createUser`, `updateUserStatus`, `resetPassword` |
| `src/project/project.service.ts` | `project.service.spec.ts` | `createProject`, `updateProject`, `deleteProject` |
| `src/role/role.service.ts` | `role.service.spec.ts` | `getRoles`, `assignRole` |
| `src/user-role/user-role.service.ts` | `user-role.service.spec.ts` | `createUserRole`, `batchAssign`, `deleteUserRole` |
| `src/account/account.service.ts` | `account.service.spec.ts` | `createAccount`, `updateAccount`, `deleteAccount` |
| `src/workflow/workflow.service.ts` | `workflow.service.spec.ts` | `startWorkflow`, `signalWorkflow` |
| `src/worker-registration/worker-registration.service.ts` | `worker-registration.service.spec.ts` | `registerWorker`, `getRegistrationToken` |
| `src/email/email.service.ts` | `email.service.spec.ts` | `sendEmail` (mock Nodemailer transport) |
| `src/upgrade/upgrade.service.ts` | `upgrade.service.spec.ts` | `uploadBundle`, `executeUpgrade` |

**Setup file:** `src/test-setup.ts` — loaded via `setupFilesAfterSetup`.

**Entities to know:** `src/entities/` — `User`, `Project`, `Account`, `Role`, `UserRole`, `Setting`.

---

### config-service (`services/config-service/`)

| Source | Spec | Key Methods to Test |
|--------|------|---------------------|
| `src/configurations/configuration.service.ts` | `configuration.service.spec.ts` | `createFileServer`, `updateFileServer`, `getFileServerDetails`, `refreshFileServer` |
| `src/workflow/workflow.service.ts` | `workflow.service.spec.ts` | `startDiscoveryWorkflow` |
| `src/path-upload/path-upload.service.ts` | `path-upload.service.spec.ts` | `uploadPathFile`, `confirmUpload` |
| `src/storage-clients/isilon/isilon-storage-client.ts` | `isilon-storage-client.spec.ts` | `listExports`, `getVolumeInfo` |
| `src/support-bundle/support-bundle.service.ts` | `support-bundle.service.spec.ts` | `generateBundle`, `downloadBundle` |
| `src/work-manager/work-manager.service.ts` | `work-manager.service.spec.ts` | `mountExport`, `unmountExport` |

**Entities:** `FileServerConfig`, `FileServer`, `Volume`, `ExportPath`.

---

### jobs-service (`services/jobs-service/`)

| Source | Spec | Key Methods to Test |
|--------|------|---------------------|
| `src/jobconfig/jobconfig.service.ts` | `jobconfig.service.spec.ts` | `createBulkDiscovery`, `createBulkMigration`, `createBulkCutover`, `deleteJob` |
| `src/jobrun/jobrun.service.ts` | `jobrun.service.spec.ts` | `getJobRunDetails`, `updateJobRunStatus`, `approveRejectCutover` |
| `src/workflow/workflow.service.ts` | `workflow.service.spec.ts` | `triggerWorkflow`, `triggerAdHocRun` |
| `src/workers/workers.service.ts` | `workers.service.spec.ts` | `getWorkerStatus`, `handleJobRunStateChange` |
| `src/tasks/tasks.service.ts` | `tasks.service.spec.ts` | `getTasksByJobRun` |
| `src/redis/redis.service.ts` | `redis.service.spec.ts` | `getJobStats`, `publishEvent` |

**External deps:** PostgreSQL + Redis + Temporal + HTTP.

---

### reports-service (`services/reports-service/`)

| Source | Spec | Key Methods to Test |
|--------|------|---------------------|
| `src/discovery/discovery.service.ts` | `discovery.service.spec.ts` | `generateDiscoveryReport`, `downloadDiscoveryCSV` |
| `src/reports/reports.service.ts` | `reports.service.spec.ts` | `prepareDownload`, `downloadByToken` |
| `src/pdf/pdf.service.ts` | `pdf.service.spec.ts` | `generatePDF` (mock Puppeteer) |
| `src/csv/csv.service.ts` | `csv.service.spec.ts` | `generateCSV`, `parseCSV` |
| `src/asup/asup.service.ts` | `asup.service.spec.ts` | `uploadToASUP`, `generateMetricsXML` |
| `src/worker/worker.service.ts` | `worker.service.spec.ts` | `startTemporalWorker` |

**Puppeteer mock pattern:**
```typescript
const mockBrowser = {
  newPage: jest.fn().mockResolvedValue({
    goto: jest.fn(),
    setContent: jest.fn(),
    pdf: jest.fn().mockResolvedValue(Buffer.from('fake-pdf')),
    close: jest.fn(),
  }),
  close: jest.fn(),
};
jest.mock('puppeteer', () => ({
  launch: jest.fn().mockResolvedValue(mockBrowser),
}));
```

---

### db-writer (`services/db-writer/`)

| Source | Spec | Key Methods to Test |
|--------|------|---------------------|
| `src/inventory/inventory.service.ts` | `inventory.service.spec.ts` | `upsertInventoryBatch`, `markAsDeleted` |
| `src/redis-consumer/redis-consumer.service.ts` | `redis-consumer.service.spec.ts` | `startConsumer`, `processStreamData`, `handleShutdown` |
| `src/redis-consumer/consumerWorker.ts` | (test in isolation) | `processBatch`, `saveTasks`, `ackMessages` |
| `src/workflow/workflow.service.ts` | `workflow.service.spec.ts` | `signalCompletion` |

**Worker-thread mock pattern:**
```typescript
jest.mock('worker_threads', () => ({
  parentPort: {
    postMessage: jest.fn(),
    on: jest.fn(),
  },
  workerData: { config: {} },
  isMainThread: false,
}));
```

---

### worker (`services/worker/`)

| Source | Spec | Key Methods to Test |
|--------|------|---------------------|
| `src/activities/core/discover/*.activity.ts` | `*.spec.ts` | `scanDirectory`, `countFiles`, `detectFileType` |
| `src/activities/core/migrate/*.activity.ts` | `*.spec.ts` | `copyFile`, `stampMetadata`, `verifyChecksum` |
| `src/activities/core/cutover/*.activity.ts` | `*.spec.ts` | `finalSync`, `generateCocReport` |
| `src/activities/common/*.service.ts` | `*.spec.ts` | `mountVolume`, `unmountVolume`, `runShellCommand` |
| `src/workflows/scan.workflow.ts` | `scan.workflow.spec.ts` | Full workflow via `TestWorkflowEnvironment` |
| `src/workflows/sync.workflow.ts` | `sync.workflow.spec.ts` | Migration workflow |
| `src/protocols/nfs/*.ts` | `*.spec.ts` | NFS mount/unmount/scan |
| `src/protocols/smb/*.ts` | `*.spec.ts` | SMB mount/unmount/ACL read/write |
| `src/work-manager/work-manager.service.ts` | `work-manager.service.spec.ts` | Task queue management |
| `src/redis/redis.service.ts` | `redis.service.spec.ts` | Stream read/write |

**Temporal activity mock pattern (without TestWorkflowEnvironment):**
```typescript
import { MockActivityEnvironment } from '@temporalio/testing';

describe('scanDirectoryActivity', () => {
  let env: MockActivityEnvironment;

  beforeEach(() => {
    env = new MockActivityEnvironment();
  });

  it('should return file list', async () => {
    const mockFs = { readdir: jest.fn().mockResolvedValue(['a.txt', 'b.txt']) };
    const result = await env.run(scanDirectoryActivity, {
      sourcePath: '/export/vol1',
      fsClient: mockFs,
    });
    expect(result.files).toHaveLength(2);
  });
});
```

**Shell command mock pattern (for NFS/SMB operations):**
```typescript
import { execSync } from 'child_process';
jest.mock('child_process', () => ({
  execSync: jest.fn().mockReturnValue(Buffer.from('mount success')),
  exec: jest.fn((cmd, cb) => cb(null, 'output', '')),
}));
```

---

### support-service (`services/support-service/`)

| Source | Spec | Key Methods to Test |
|--------|------|---------------------|
| `src/activities/generate-bundle.activity.ts` | `*.spec.ts` | `collectLogs`, `createZip` |
| `src/activities/notify-config.activity.ts` | `*.spec.ts` | `notifyBundleReady` |
| `src/prometheus/prometheus.service.ts` | `*.spec.ts` | `queryPrometheus`, `getTargets` |
| `src/services/zip.service.ts` | `*.spec.ts` | `createArchive`, `extractArchive` |
| `src/services/csv-writer.service.ts` | `*.spec.ts` | `writeCsv` |

---

### datamigrator-ui (`services/datamigrator-ui/`) — NO TESTS YET

**Priority files to test first:**

| File | What to Test | How |
|------|-------------|-----|
| `src/api/configApi.ts` | API call shapes, error handling | Mock fetch / msw |
| `src/api/jobsApi.ts` | Job creation payload, polling logic | Mock fetch / msw |
| `src/api/userApi.ts` | User CRUD, role assignment | Mock fetch / msw |
| `src/store/reducer/authSlice.ts` | Login/logout state transitions | Direct reducer test |
| `src/store/reducer/permissionSlice.ts` | Permission checks | Direct reducer test |
| `src/auth/auth.utils.ts` | `hasPermission()`, role checks | Pure function test |
| `src/utils/common.utils.ts` | `decryptData()`, `getProjectPermissions()` | Pure function test |
| `src/components/top-nav-bar/setting/ManageUsers/ManageUsers.tsx` | Add User flow renders correctly | RTL + mock API |
| `src/components/top-nav-bar/setting/ManageProjects/ManageProjects.tsx` | Projects table renders | RTL + mock API |

**Redux store mock pattern (for component tests):**
```typescript
import { configureStore } from '@reduxjs/toolkit';
import { render } from '@testing-library/react';
import { Provider } from 'react-redux';
import authReducer from '@store/reducer/authSlice';
import permissionReducer from '@store/reducer/permissionSlice';

function renderWithStore(ui: React.ReactElement, preloadedState = {}) {
  const store = configureStore({
    reducer: {
      authSlice: authReducer,
      permissionSlice: permissionReducer,
    },
    preloadedState,
  });
  return render(<Provider store={store}>{ui}</Provider>);
}
```

**MSW (Mock Service Worker) pattern for API mocking:**
```typescript
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';

const server = setupServer(
  http.get('/api/v1/users', () =>
    HttpResponse.json({ data: { items: [{ id: '1', email: 'test@test.com' }] } }),
  ),
  http.post('/api/v1/create-user', () =>
    HttpResponse.json({ data: { tempPassword: 'abc123' }, message: 'User created' }),
  ),
);

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
```

---

## Common Testing Mistakes to Avoid

### 1. Testing implementation, not behaviour
```typescript
// BAD — tests HOW, breaks on refactor
expect(mockRepo.save).toHaveBeenCalledWith({ name: 'test', status: 'active' });

// GOOD — tests WHAT
const result = await service.createProject('test');
expect(result.name).toBe('test');
expect(result.status).toBe('active');
```

### 2. Not resetting mocks between tests
```typescript
// BAD — state leaks from test 1 to test 2
beforeAll(() => { mockRepo.find.mockResolvedValue([{ id: '1' }]); });

// GOOD
beforeEach(() => { jest.clearAllMocks(); });
```

### 3. Forgetting to test error paths
```typescript
// Always add a "should throw" test for each dependency:
it('should throw when database is unavailable', async () => {
  mockRepo.save.mockRejectedValue(new Error('connection refused'));
  await expect(service.createProject('test')).rejects.toThrow('connection refused');
});
```

### 4. Using real timers
```typescript
// BAD — test takes 5 real seconds
await new Promise(r => setTimeout(r, 5000));

// GOOD
jest.useFakeTimers();
jest.advanceTimersByTime(5000);
jest.useRealTimers();
```

---

## Coverage Gaps Across the Codebase

| Service | Verified Spec Count | Known Gaps |
|---------|-------------------|------------|
| admin-service | **63 specs** | Upgrade flow edge cases, SMTP send failure handling |
| config-service | **16 specs** | Path upload confirm, work-manager mount/unmount error paths |
| jobs-service | **27 specs** | Bulk cutover approve/reject, Redis pub/sub, error remedies |
| reports-service | **31 specs** | ASUP chunked upload, consolidated report for 12M+ files |
| db-writer | **15 specs** | Worker thread crash recovery, batch failure handling, database-pool reconnect |
| worker | **81 specs** | SMB ACL stamp edge cases (win-operations), deferred-dir-stamp, protocol fallback |
| support-service | **25 specs** | Prometheus query timeout, large ZIP (>200MB) generation, ASUP manifest |
| datamigrator-ui | **0 specs** | **Everything** — start with pure utils + Redux reducers + API layer |
