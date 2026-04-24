# ansible-template-lint

Static consistency checks for Ansible Jinja2 templates under
`app-deployment/ansible/control-plane/roles/`. The linter renders template
pairs with stub variables and asserts they remain consistent with each other
before a PR lands, instead of waiting for a ~90-minute VM image build to fail.

## Why this exists

Several roles ship pairs of templates where one file renders a Kubernetes
`PersistentVolume` and another renders Helm chart values that pick that volume
up via a `selector.matchLabels`. When the two drift (for example, a PV's
`metadata.labels.role` is renamed without updating the chart selector), the
PVC never binds, the pod stays `Pending`, and the build's `kubectl wait` step
eventually times out. Commit `c589fef7b` fixed exactly this drift for the
Prometheus and Alertmanager PVs.

The linter is a ~second fast-feedback net that catches the same class of bug
on PR instead of on the image builder.

## What it checks

`lint_pv_selectors.py` declares a list of `SelectorCheck` entries. Each entry
points at:

- a PV template (renders one or more `PersistentVolume` docs)
- a Helm-values template (contains a `selector.matchLabels` dict under some
  chart-specific path)
- a callable that extracts that `matchLabels` dict from the parsed values

For every entry the linter renders both templates with a small set of stub
variables, parses the YAML, and asserts every `(key, value)` in the selector
is present on the target PV's `metadata.labels`.

Add more checks by appending to the `CHECKS` list in `lint_pv_selectors.py`.

## Running locally

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Lint the real templates
python lint_pv_selectors.py

# Exercise the linter's own fixtures (good + bad)
python lint_pv_selectors.py --self-test
```

Exits 0 on success, 1 on any mismatch.

## CI integration

`.github/workflows/ansible-template-lint.yaml` runs the linter on every PR
that touches files under `app-deployment/ansible/control-plane/roles/` or
`app-deployment/tests/ansible-template-lint/`.
