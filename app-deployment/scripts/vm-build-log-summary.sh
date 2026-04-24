#!/usr/bin/env bash
# Summarize VM image build outputs for GitHub Actions: artifact sizes, log sizes, optional timing hints.
# Usage: vm-build-log-summary.sh <log_dir> <packer_dir> <provider> <component>
set -euo pipefail

LOGDIR="${1:-}"
PACKER_DIR="${2:-}"
PROVIDER="${3:-}"
COMPONENT="${4:-}"
SUMMARY="${GITHUB_STEP_SUMMARY:-}"

section() {
  local title="$1"
  if [[ -n "${SUMMARY}" && -w "$(dirname "$SUMMARY")" ]]; then
    {
      echo ""
      echo "### ${title}"
      echo ""
    } >> "${SUMMARY}"
  fi
  echo ""
  echo "=== ${title} ==="
}

row() {
  local path="$1"
  local label="$2"
  if [[ -e "$path" ]]; then
    local sz
    sz=$(du -h "$path" 2>/dev/null | awk '{print $1}')
    echo "| ${label} | ${sz} |"
    if [[ -n "${SUMMARY}" && -w "$(dirname "$SUMMARY")" ]]; then
      echo "| ${label} | ${sz} |" >> "${SUMMARY}"
    fi
  fi
}

section "VM build diagnostics (${COMPONENT} / ${PROVIDER})"

if [[ -n "${SUMMARY}" && -w "$(dirname "$SUMMARY")" ]]; then
  {
    echo "| Artifact | Size |"
    echo "|----------|------|"
  } >> "${SUMMARY}"
fi

echo "| Artifact | Size |"
echo "|----------|------|"

if [[ -n "${LOGDIR}" && -d "${LOGDIR}" ]]; then
  for f in "${LOGDIR}"/*; do
    [[ -f "$f" ]] || continue
    case "$f" in
      *.log|*.md) row "$f" "$(basename "$f")" ;;
    esac
  done
fi

if [[ -f "${GITHUB_WORKSPACE:-}/packer.log" ]]; then
  row "${GITHUB_WORKSPACE}/packer.log" "packer.log (workspace)"
fi

section "Image/export artifacts under packer tree (${PACKER_DIR})"

if [[ -n "${SUMMARY}" && -w "$(dirname "$SUMMARY")" ]]; then
  {
    echo "| File | Size |"
    echo "|------|------|"
  } >> "${SUMMARY}"
fi

echo "| File | Size |"
echo "|------|------|"

if [[ -n "${PACKER_DIR}" && -d "${PACKER_DIR}" ]]; then
  count=0
  while IFS= read -r f; do
    [[ -n "$f" ]] || continue
    row "$f" "${f#"${GITHUB_WORKSPACE:-}/"}"
    count=$((count + 1))
    [[ "$count" -ge 80 ]] && break
  done < <(find "${PACKER_DIR}" \( -name '*.ova' -o -name '*.ovf' -o -name '*.vmdk' -o -name '*.mf' -o -name '*.zip' \
    -o -name '*.vhd' -o -name '*.vhdx' -o -name '*.tar' -o -name '*.tar.gz' \) -type f 2>/dev/null | head -80)
fi

section "Ansible profile_tasks (tail — search full ansible log for full table)"

ANSIBLE_LOG=""
if [[ -n "${LOGDIR}" ]]; then
  ANSIBLE_LOG=$(find "${LOGDIR}" -maxdepth 1 -name 'ansible-*.log' -type f 2>/dev/null | head -1)
fi
if [[ -n "${ANSIBLE_LOG}" && -f "${ANSIBLE_LOG}" ]]; then
  echo "(last 80 lines of ${ANSIBLE_LOG})"
  tail -n 80 "${ANSIBLE_LOG}" || true
  if [[ -n "${SUMMARY}" && -w "$(dirname "$SUMMARY")" ]]; then
    echo "" >> "${SUMMARY}"
    echo '```' >> "${SUMMARY}"
    tail -n 40 "${ANSIBLE_LOG}" >> "${SUMMARY}" || true
    echo '```' >> "${SUMMARY}"
  fi
else
  echo "No ansible log file found under ${LOGDIR:-<empty>}"
fi

echo "vm-build-log-summary: done"
