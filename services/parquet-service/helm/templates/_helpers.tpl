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

{{- define "parquet-service.volumeMounts" -}}
- name: data
  mountPath: {{ .Values.pvc.mountPath }}
- name: jwt
  mountPath: /etc/parquet-service/jwt
  readOnly: true
- name: temporal-tls
  mountPath: /etc/parquet-service/temporal-tls
  readOnly: true
{{- end -}}

{{- define "parquet-service.volumes" -}}
- name: data
  persistentVolumeClaim:
    claimName: {{ .Values.nameOverride }}-data
- name: jwt
  secret:
    secretName: {{ .Values.auth.jwtSecretName }}
    optional: true
- name: temporal-tls
  secret:
    secretName: {{ .Values.auth.temporalTlsSecretName }}
    optional: true
{{- end -}}
