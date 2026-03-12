# Git hooks

Pre-commit and other hooks are managed by [Husky](https://github.com/typicode/husky).

**Setup (automatic):** Run `npm install` at the repo root once. The `prepare` script installs Husky and configures Git to use `.husky/`.

**Manual setup:** Run `./setup-hooks.sh` from the repo root.

**Pre-commit:** When you commit changes under `services/jobs-service/**/*.ts`, ESLint runs on the staged files. Fix any reported issues before the commit succeeds.

**CI / production:** Set `HUSKY=0` to skip hook installation (e.g. in Docker or CI).
