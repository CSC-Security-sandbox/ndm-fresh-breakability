{{/* Default Template for Deployment. All Sub-Charts under this Chart can include the below template. */}}
{{- define "datamigrator.deploymenttemplate" }}
apiVersion: {{ .Values.kubeApiVersion }}
kind: Deployment
metadata:
  name: {{ .Values.appName  }}
spec:
  replicas: {{ .Values.replicaCount  }}
  selector:
    matchLabels:
      app: {{ .Values.appName  }}
  template:
    metadata:
      annotations:
      {{- if .Values.annotations }}
        {{- toYaml .Values.annotations | nindent 8}}
      {{- end }}
      labels:
        app: {{ .Values.appName  }}
        app.kubernetes.io/name: "datamigrator"
        app.kubernetes.io/service: "{{ .Values.appName }}"
        app.kubernetes.io/part-of: "datamigrator"
        app.kubernetes.io/managed-by: "helm"
        {{- if .Values.global.build_version }}
        build-version: "{{ .Values.global.build_version }}"
        {{- end }}
    spec:
      {{- if .Values.differentNodes }}
      affinity:
        podAntiAffinity:
          preferredDuringSchedulingIgnoredDuringExecution:
          - weight: 100
            podAffinityTerm:
              labelSelector:
                matchExpressions:
                - key: app
                  operator: In
                  values:
                  - {{ .Values.appName }}
              topologyKey: "kubernetes.io/hostname"
      {{- if .Values.extraNodeAffinity }}
        {{- toYaml .Values.extraNodeAffinity | nindent 8 }}
      {{- end }}
      {{- end }}
      serviceAccountName: {{- if .Values.serviceAccountName }} {{ .Values.serviceAccountName }} {{- end }}
      {{- if .Values.runAs1001 }}
      securityContext:
        runAsUser: 1001
        runAsGroup: 1001
        fsGroup: 1001
      {{- end }}
      containers:
      - name: {{ .Values.appName }}
        image: {{ if .Values.global.registry }}{{ .Values.global.registry }}/{{ end }}{{ .Values.image.repository }}:{{ .Values.image.tag }}
        {{- if .Values.command }}
        command: [{{ .Values.command }}]
        {{- end }}
        {{- if .Values.args }}
        args:
        {{- toYaml .Values.args | nindent 8 }}
        {{- end }}
        envFrom:
        {{- if .Values.envFrom }}
        {{- toYaml .Values.envFrom | nindent 8}}
        {{- end }}
        env:
        {{- if .Values.env }}
        {{- toYaml .Values.env | nindent 8}}
        {{- end }}
        {{- if .Values.addResourceLimits }}
        resources:
          requests:
            memory: {{ .Values.memoryRequest }}
            cpu: {{ .Values.cpuRequest }}
          limits:
            memory: {{ .Values.memoryLimit }}
            cpu: {{ .Values.cpuLimit }}
        {{- end }}
        {{- if .Values.addLivenessProbes }}
        livenessProbe:
          exec:
            command:
            - ls
          initialDelaySeconds: {{ .Values.livenessProbe.initialDelaySeconds | default 30 }}
          periodSeconds: {{ .Values.livenessProbe.periodSeconds | default 10 }}
        {{- end }}
        {{- if .Values.addReadinessProbes }}
        readinessProbe:
          httpGet:
            path: /readiness
            port: 8080
          initialDelaySeconds: {{ .Values.readinessProbe.initialDelaySeconds | default 20 }}
          periodSeconds: {{ .Values.readinessProbe.periodSeconds | default 5 }}
        {{- end }}
        imagePullPolicy: {{ if .Values.global.local_cluster }}Always{{ else }}Never{{ end }}
        {{- if .Values.persistentVolumes }}
        volumeMounts:
          {{- range .Values.persistentVolumes }}
          - name: {{ .name }}
            mountPath: {{ .mountPath }}
          {{- end }}
        {{- end }}

      {{- if .Values.persistentVolumes }}
      volumes:
        {{- range .Values.persistentVolumes }}
        - name: {{ .name }}
          hostPath:
            path: {{ .hostPath }}
            type: DirectoryOrCreate
        {{- end }}
      {{- end }}
{{- end }}

{{/* Default Template for Service. All Sub-Charts under this Chart can include the below template. */}}
{{- define "datamigrator.servicetemplate" }}
apiVersion: v1
kind: Service
metadata:
  name: {{ .Values.appName }}-service
  labels:
    app: {{ .Values.appName }}
    app.kubernetes.io/name: "datamigrator"
    app.kubernetes.io/service: "{{ .Values.appName }}"
    app.kubernetes.io/part-of: "datamigrator"
    app.kubernetes.io/managed-by: "helm"
spec:
  type: {{ .Values.service.type }}
  ports:
    - port: {{ .Values.service.port }}
      protocol: TCP
      targetPort: {{ .Values.service.targetPort }}
  selector:
    app: {{ .Values.appName }}
{{- end }}

{{/* Template for Non throttled Ingress (Rate-limited APIs). */}}
{{- define "datamigrator.ingresstemplate" }}
{{- if .Values.ingress }}
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: {{ .Values.appName }}-ingress
  {{- if .Values.ingress.userDefinedAnnotations }}
  annotations:
    {{- toYaml .Values.ingress.userDefinedAnnotations | nindent 4 }}
  {{- end }}
spec:
  ingressClassName: {{ .Values.ingress.ingressClassName }}
  rules:
  - host: {{ .Values.ingress.host }}
    http:
      paths:
      {{- if .Values.ingress.pathPrefix }}
      - path: /{{ .Values.ingress.pathPrefix }}{{ .Values.ingress.trailingPath }}(?:/|$)
      {{- else }}
      - path: /
      {{- end }}
        pathType: ImplementationSpecific
        backend:
          service:
            name: {{ .Values.appName }}-service
            port:
              number: {{ .Values.service.port }}
  {{- if .Values.ingress.tls.enabled }}
  tls:
  - hosts:
    - {{ .Values.ingress.host }}
    secretName: {{ .Values.ingress.tls.secretName | default (printf "%s-tls" .Values.appName) }}
  {{- end }}
{{- end }}
{{- end }}

{{/* Template for Regular Ingress (Throttled APIs). */}}
{{- define "datamigrator.throttledingresstemplate" }}
{{- if .Values.ingressThrottle }}
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: {{ .Values.appName }}-throttled-ingress
  {{- if .Values.ingressThrottle.userDefinedAnnotations }}
  annotations:
    {{- toYaml .Values.ingressThrottle.userDefinedAnnotations | nindent 4 }}
  {{- end }}
spec:
  ingressClassName: {{ .Values.ingressThrottle.ingressClassName }}
  rules:
  - host: {{ .Values.ingressThrottle.host }}
    http:
      paths:
      {{- if .Values.ingressThrottle.pathPrefix }}
      - path: /{{ .Values.ingressThrottle.pathPrefix }}{{ .Values.ingressThrottle.trailingPath }}(?:/|$)
      {{- else }}
      - path: /
      {{- end }}
        pathType: ImplementationSpecific
        backend:
          service:
            name: {{ .Values.appName }}-service
            port:
              number: {{ .Values.service.port }}
  {{- if .Values.ingressThrottle.tls.enabled }}
  tls:
  - hosts:
    - {{ .Values.ingressThrottle.host }}
    secretName: {{ .Values.ingressThrottle.tls.secretName | default (printf "%s-throttled-tls" .Values.appName) }}
  {{- end }}
{{- end }}
{{- end }}

{{/* Build an Istio HTTP match from an ingress-style config */}}
{{- define "datamigrator.istioHttpMatch" -}}
{{- $config := .config | default dict -}}
{{- if $config.exactPaths }}
{{/* Exact path matching for specific endpoints */}}
{{- range $path := $config.exactPaths }}
uri:
  exact: {{ $path }}
{{- end }}
{{- else if $config.prefixPaths }}
{{/* Prefix matching for endpoint groups (matches all subpaths automatically) */}}
{{- range $prefix := $config.prefixPaths }}
uri:
  prefix: {{ $prefix }}
{{- end }}
{{- else if $config.useRegex }}
{{/* Custom regex pattern (e.g., for negative lookahead) */}}
uri:
  regex: {{ $config.pathPattern | quote }}
{{- else if and $config.pathPrefix $config.trailingPath }}
{{/* Legacy regex approach - kept for backward compatibility */}}
uri:
  regex: "^/{{ $config.pathPrefix }}{{ $config.trailingPath }}(?:/|$)"
{{- else if $config.trailingPath }}
uri:
  regex: "^/{{ $config.trailingPath }}(?:/|$)"
{{- else if $config.pathPrefix }}
{{/* Simple prefix matching */}}
uri:
  prefix: /{{ $config.pathPrefix }}
{{- else }}
{{/* Default catch-all */}}
uri:
  prefix: /
{{- end }}
{{- end }}

{{/* Optional Istio VirtualService per workload */}}
{{- define "datamigrator.istioVirtualService" -}}
{{- $values := .Values -}}
{{- $global := $values.global | default dict -}}
{{- $istio := $global.istio | default dict -}}
{{- if and ($istio.enabled | default false) (or $values.ingress $values.ingressThrottle) }}
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: {{ $values.appName }}-virtualservice
spec:
  hosts:
  {{- range $host := $istio.hosts | default (list "*") }}
  - {{ $host | quote }}
  {{- end }}
  gateways:
  {{- $gatewayName := $istio.gateway.name | default "datamigrator-gateway" -}}
  {{- $gatewayNamespace := $istio.gateway.namespace | default .Release.Namespace -}}
  {{- if eq $gatewayNamespace .Release.Namespace }}
  - {{ $gatewayName }}
  {{- else }}
  - {{ printf "%s/%s" $gatewayNamespace $gatewayName }}
  {{- end }}
  http:
  {{- if $values.ingressThrottle }}
  {{- if $values.ingressThrottle.prefixPaths }}
  {{- range $index, $path := $values.ingressThrottle.prefixPaths }}
  - name: {{ printf "%s-throttled-%d" $values.appName $index }}
    match:
      - uri:
          prefix: {{ $path }}
    timeout: 300s  # 5 minutes for API operations
    route:
      - destination:
          host: {{ printf "%s-service.%s.svc.cluster.local" $values.appName $.Release.Namespace }}
          port:
            number: {{ $values.service.port }}
  {{- end }}
  {{- else if $values.ingressThrottle.exactPaths }}
  {{- range $index, $path := $values.ingressThrottle.exactPaths }}
  - name: {{ printf "%s-throttled-%d" $values.appName $index }}
    match:
      - uri:
          exact: {{ $path }}
    timeout: 300s  # 5 minutes for API operations
    route:
      - destination:
          host: {{ printf "%s-service.%s.svc.cluster.local" $values.appName $.Release.Namespace }}
          port:
            number: {{ $values.service.port }}
  {{- end }}
  {{- else }}
  - name: {{ printf "%s-throttled" $values.appName }}
    match:
      - {{ include "datamigrator.istioHttpMatch" (dict "config" $values.ingressThrottle) | nindent 8 }}
    timeout: 300s  # 5 minutes for API operations
    route:
      - destination:
          host: {{ printf "%s-service.%s.svc.cluster.local" $values.appName $.Release.Namespace }}
          port:
            number: {{ $values.service.port }}
  {{- end }}
  {{- end }}
  {{- if $values.ingress }}
  {{- if $values.ingress.prefixPaths }}
  {{- range $index, $path := $values.ingress.prefixPaths }}
  - name: {{ printf "%s-default-%d" $values.appName $index }}
    match:
      - uri:
          prefix: {{ $path }}
    timeout: 300s  # 5 minutes for API operations
    route:
      - destination:
          host: {{ printf "%s-service.%s.svc.cluster.local" $values.appName $.Release.Namespace }}
          port:
            number: {{ $values.service.port }}
  {{- end }}
  {{- else if $values.ingress.exactPaths }}
  {{- range $index, $path := $values.ingress.exactPaths }}
  - name: {{ printf "%s-default-%d" $values.appName $index }}
    match:
      - uri:
          exact: {{ $path }}
    timeout: 300s  # 5 minutes for API operations
    route:
      - destination:
          host: {{ printf "%s-service.%s.svc.cluster.local" $values.appName $.Release.Namespace }}
          port:
            number: {{ $values.service.port }}
  {{- end }}
  {{- else }}
  - name: {{ printf "%s-default" $values.appName }}
    match:
      - {{ include "datamigrator.istioHttpMatch" (dict "config" $values.ingress) | nindent 8 }}
    timeout: 300s  # 5 minutes for API operations
    route:
      - destination:
          host: {{ printf "%s-service.%s.svc.cluster.local" $values.appName $.Release.Namespace }}
          port:
            number: {{ $values.service.port }}
  {{- end }}
  {{- end }}
{{- end }}
{{- end }}

{{/* Default Template for HPA. All Sub-Charts under this Chart can include the below template. */}}
{{- define "datamigrator.hpatemplate" }}
{{- if .Values.hpa.enabled }}
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  namespace: {{ .Values.namespace | default .Release.Namespace }}
  name: {{ .Release.Name }}-hpa
  labels:
    app: {{ .Chart.Name }}
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: {{ .Release.Name }}-deployment
  minReplicas: {{ .Values.hpa.minReplicas }}
  maxReplicas: {{ .Values.hpa.maxReplicas }}
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: {{ .Values.hpa.cpuUtilization }}
    {{- if .Values.hpa.enableMemoryScaling }}
    - type: Resource
      resource:
        name: memory
        target:
          type: Utilization
          averageUtilization: {{ .Values.hpa.memoryUtilization }}
    {{- end }}
{{- end }}
{{- end }}

{{/* Default Template for DB Migration Job. All Sub-Charts under this Chart can include the below template. */}}
{{- define "datamigrator.jobtemplate" }}
apiVersion: batch/v1
kind: Job
metadata:
  name: {{ .Values.appName }}
  labels:
    app: {{ .Values.appName }}
    app.kubernetes.io/name: "datamigrator"
    app.kubernetes.io/service: "{{ .Values.appName }}"
    app.kubernetes.io/part-of: "datamigrator"
    app.kubernetes.io/managed-by: "helm"
  annotations:
    "helm.sh/hook": pre-install,pre-upgrade,pre-rollback
    "helm.sh/hook-delete-policy": before-hook-creation,hook-succeeded
spec:
  template:
    metadata:
      labels:
        app: {{ .Values.appName }}
        app.kubernetes.io/name: "datamigrator"
        app.kubernetes.io/service: "{{ .Values.appName }}"
        app.kubernetes.io/part-of: "datamigrator"
        app.kubernetes.io/managed-by: "helm"
      annotations:
        {{- toYaml .Values.annotations | nindent 8 }}
    spec:
      serviceAccountName: {{ .Values.serviceAccountName }}
      restartPolicy: OnFailure
      containers:
        - name: db-migrations
          image: {{ if .Values.global.registry }}{{ .Values.global.registry }}/{{ end }}{{ .Values.image.repository }}:{{ .Values.image.tag }}
          imagePullPolicy: {{ if .Values.global.local_cluster }}Always{{ else }}Never{{ end }}
          env:
            {{- toYaml .Values.env | nindent 12 }}
          args:
            {{- toYaml .Values.args | nindent 12 }}
{{- end }}
