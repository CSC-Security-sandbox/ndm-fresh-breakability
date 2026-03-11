#!/bin/sh
git config core.hooksPath .githooks
chmod +x .githooks/pre-commit
echo "Git hooks configured. Pre-commit lint is now active for jobs-service."
