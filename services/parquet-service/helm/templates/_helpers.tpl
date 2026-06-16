{{- define "parquet-service.envFrom" -}}
envFrom:
  - configMapRef:
      name: {{ .Values.nameOverride }}-config
env:
  - name: JWT_PUBLIC_KEY_PATH
    value: "/etc/parquet-service/jwt/public.pem"
  - name: TEMPORAL_TLS_CERT
    value: "/etc/parquet-service/temporal-tls/tls.crt"
  - name: TEMPORAL_TLS_KEY
    value: "/etc/parquet-service/temporal-tls/tls.key"
  - name: TEMPORAL_TLS_CA
    value: "/etc/parquet-service/temporal-tls/ca.crt"
{{- end -}}

{{/*
Volumes are scoped per role:
  api    -> jwt (verify inbound tokens) + temporal-tls (client). NOT the data PVC — the API never
            reads/writes /data, and the PVC is ReadWriteOnce (sharing it would block co-scheduling).
  worker -> data PVC (writes Parquet) + temporal-tls (client). No jwt — it serves no HTTP/auth.
*/}}
{{- define "parquet-service.api.volumeMounts" -}}
- name: jwt
  mountPath: /etc/parquet-service/jwt
  readOnly: true
- name: temporal-tls
  mountPath: /etc/parquet-service/temporal-tls
  readOnly: true
{{- end -}}

{{- define "parquet-service.api.volumes" -}}
- name: jwt
  secret:
    secretName: {{ .Values.auth.jwtSecretName }}
    optional: true
- name: temporal-tls
  secret:
    secretName: {{ .Values.auth.temporalTlsSecretName }}
    optional: true
{{- end -}}

{{- define "parquet-service.worker.volumeMounts" -}}
- name: data
  mountPath: {{ .Values.pvc.mountPath }}
- name: temporal-tls
  mountPath: /etc/parquet-service/temporal-tls
  readOnly: true
{{- end -}}

{{- define "parquet-service.worker.volumes" -}}
- name: data
  persistentVolumeClaim:
    claimName: {{ .Values.nameOverride }}-data
- name: temporal-tls
  secret:
    secretName: {{ .Values.auth.temporalTlsSecretName }}
    optional: true
{{- end -}}
