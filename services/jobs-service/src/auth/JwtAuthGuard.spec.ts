import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from '@netapp-cloud-datamigrate/auth-lib';
import { JwtService, Permission } from '@netapp-cloud-datamigrate/auth-lib';

/**
 * NDM-3337 — Project Admin 403 on directory-level migration.
 *
 * Root cause: the UI's ExploreModal called POST /jobs/get-dirs without the
 * `projectid` header. The JwtAuthGuard requires this header for project-scoped
 * roles (Project Admin / Viewer) to match the JWT's projects array.
 *
 * App Admin bypasses the check because its JWT has projects: [] (empty).
 * Project Admin has projects: ["<uuid>"], so includes(undefined) → false → 403.
 *
 * These tests validate the guard's projectid-matching logic for all three roles.
 */
describe('JwtAuthGuard — projectid header & RBAC (NDM-3337)', () => {
  let guard: JwtAuthGuard;
  let reflector: Reflector;
  let mockJwtService: { verifyToken: jest.Mock };

  const createContext = (
    authHeader?: string,
    projectId?: string,
  ): ExecutionContext => {
    const headers: Record<string, string | undefined> = {
      authorization: authHeader,
      projectid: projectId,
    };
    return {
      switchToHttp: () => ({
        getRequest: () => ({ headers }),
      }),
      getHandler: () => jest.fn(),
    } as unknown as ExecutionContext;
  };

  const appAdminUser = {
    roles: [{
      role_name: 'App Admin',
      projects: [] as string[],
      permissions: [
        'ManageProject', 'DeleteProject', 'UpdateProject',
        'InviteUser', 'CreateUser', 'DeleteUser', 'UpdateUser',
        'AgentDeployment', 'ManageConfig', 'ManageJob',
        'RollbackJob', 'ViewLogs', 'ViewJob', 'Reports',
        'ListUsers', 'ViewProject', 'ViewConfig', 'ViewAgentsList',
      ],
    }],
  };

  const projectAdminUser = (projectId: string) => ({
    roles: [{
      role_name: 'Project Admin',
      projects: [projectId],
      permissions: [
        'ManageProject', 'UpdateProject', 'AgentDeployment',
        'ManageConfig', 'ManageJob', 'RollbackJob', 'ViewLogs',
        'ViewJob', 'Reports', 'ListUsers', 'ViewProject',
        'ViewConfig', 'ViewAgentsList',
      ],
    }],
  });

  const projectViewerUser = (projectId: string) => ({
    roles: [{
      role_name: 'Project Viewer',
      projects: [projectId],
      permissions: [
        'ViewLogs', 'ViewJob', 'Reports', 'ListUsers',
        'ViewProject', 'ViewConfig', 'ViewAgentsList',
      ],
    }],
  });

  beforeEach(() => {
    reflector = new Reflector();
    mockJwtService = { verifyToken: jest.fn() };
    guard = new JwtAuthGuard(
      reflector,
      mockJwtService as unknown as JwtService,
    );
    jest.spyOn(reflector, 'get').mockReturnValue([Permission.ManageJob]);
  });

  // ─── NDM-3337 core scenario ────────────────────────────────────────────────

  describe('NDM-3337: projectid header missing', () => {
    it('App Admin should PASS — empty projects array bypasses project check', async () => {
      mockJwtService.verifyToken.mockResolvedValue({ user: appAdminUser });
      const ctx = createContext('Bearer token', undefined);

      expect(await guard.canActivate(ctx)).toBe(true);
    });

    it('Project Admin should FAIL (403) — this is the NDM-3337 bug trigger', async () => {
      mockJwtService.verifyToken.mockResolvedValue({
        user: projectAdminUser('proj-abc'),
      });
      const ctx = createContext('Bearer token', undefined);

      expect(await guard.canActivate(ctx)).toBe(false);
    });

    it('Project Viewer should FAIL (403) — no ManageJob + no projectid', async () => {
      mockJwtService.verifyToken.mockResolvedValue({
        user: projectViewerUser('proj-abc'),
      });
      const ctx = createContext('Bearer token', undefined);

      expect(await guard.canActivate(ctx)).toBe(false);
    });
  });

  // ─── With correct projectid header (post-fix behavior) ─────────────────────

  describe('with matching projectid header (fix applied)', () => {
    it('Project Admin should PASS with ManageJob + correct projectid', async () => {
      mockJwtService.verifyToken.mockResolvedValue({
        user: projectAdminUser('proj-abc'),
      });
      const ctx = createContext('Bearer token', 'proj-abc');

      expect(await guard.canActivate(ctx)).toBe(true);
    });

    it('Project Admin should FAIL with wrong projectid', async () => {
      mockJwtService.verifyToken.mockResolvedValue({
        user: projectAdminUser('proj-abc'),
      });
      const ctx = createContext('Bearer token', 'proj-OTHER');

      expect(await guard.canActivate(ctx)).toBe(false);
    });

    it('Project Viewer should FAIL even with correct projectid (lacks ManageJob)', async () => {
      mockJwtService.verifyToken.mockResolvedValue({
        user: projectViewerUser('proj-abc'),
      });
      const ctx = createContext('Bearer token', 'proj-abc');

      expect(await guard.canActivate(ctx)).toBe(false);
    });

    it('App Admin should PASS regardless of projectid value', async () => {
      mockJwtService.verifyToken.mockResolvedValue({ user: appAdminUser });
      const ctx = createContext('Bearer token', 'any-project');

      expect(await guard.canActivate(ctx)).toBe(true);
    });
  });

  // ─── Multi-project Project Admin ───────────────────────────────────────────

  describe('Project Admin assigned to multiple projects', () => {
    it('should PASS when header matches any assigned project', async () => {
      mockJwtService.verifyToken.mockResolvedValue({
        user: {
          roles: [{
            role_name: 'Project Admin',
            projects: ['proj-a', 'proj-b', 'proj-c'],
            permissions: ['ManageJob'],
          }],
        },
      });
      const ctx = createContext('Bearer token', 'proj-b');

      expect(await guard.canActivate(ctx)).toBe(true);
    });

    it('should FAIL when header matches none of the assigned projects', async () => {
      mockJwtService.verifyToken.mockResolvedValue({
        user: {
          roles: [{
            role_name: 'Project Admin',
            projects: ['proj-a', 'proj-b'],
            permissions: ['ManageJob'],
          }],
        },
      });
      const ctx = createContext('Bearer token', 'proj-z');

      expect(await guard.canActivate(ctx)).toBe(false);
    });
  });

  // ─── Auth edge cases ───────────────────────────────────────────────────────

  describe('authorization edge cases', () => {
    it('should FAIL when authorization header is missing', async () => {
      const ctx = createContext(undefined, 'proj-abc');

      expect(await guard.canActivate(ctx)).toBe(false);
    });

    it('should FAIL when token is empty', async () => {
      const ctx = createContext('Bearer ', 'proj-abc');

      expect(await guard.canActivate(ctx)).toBe(false);
    });

    it('should FAIL when token verification throws', async () => {
      mockJwtService.verifyToken.mockRejectedValue(new Error('Invalid'));
      const ctx = createContext('Bearer bad-token', 'proj-abc');

      expect(await guard.canActivate(ctx)).toBe(false);
    });

    it('should FAIL when decoded token has no user field', async () => {
      mockJwtService.verifyToken.mockResolvedValue({});
      const ctx = createContext('Bearer token', 'proj-abc');

      expect(await guard.canActivate(ctx)).toBe(false);
    });
  });

  // ─── No permissions required ───────────────────────────────────────────────

  describe('endpoint with no permission requirements', () => {
    it('should PASS for any authenticated user', async () => {
      jest.spyOn(reflector, 'get').mockReturnValue([]);
      mockJwtService.verifyToken.mockResolvedValue({
        user: { roles: [] },
      });
      const ctx = createContext('Bearer token');

      expect(await guard.canActivate(ctx)).toBe(true);
    });
  });
});
