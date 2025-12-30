{{- with secret "secrets/postgres-secrets/postgres-creds" -}}
export PGUSER="{{ .Data.POSTGRES_DMADMIN_USER }}"
export PGPASSWORD="{{ .Data.POSTGRES_DMADMIN_PASSWORD }}"
{{- end -}}
