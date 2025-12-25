#!/bin/bash
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

echo "Running SMB tests with Ginkgo auto-balancing (5 parallel nodes)..."
echo "- 1 shared project will be created"
echo "- Workers attached once"
echo "- Tests distributed automatically across 5 nodes"
echo ""

ginkgo run -v -p -procs=5 --stream tests/e2e -- --protocol_type=SMB --environment=Azure

echo ""
echo "SMB parallel tests completed!"
