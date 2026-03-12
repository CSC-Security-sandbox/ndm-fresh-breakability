#!/bin/sh
# Installs Husky git hooks (pre-commit lint for jobs-service).
# Run once after clone, or rely on: npm install (at repo root) which runs "prepare" and sets up hooks.
cd "$(dirname "$0")"
git config --unset-all core.hooksPath 2>/dev/null || true
npm install
echo "Git hooks configured via Husky. Pre-commit lint is now active for jobs-service."
