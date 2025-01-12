{{/* Default Template for Deployment. All Sub-Charts under this Chart can include the below template. */}}
{{- define "datamigrate.deploymenttemplate" }}
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
    spec:
      {{- if .Values.imagePullSecrets }}
      imagePullSecrets:
        - name: {{ .Values.imagePullSecrets }}
      {{- end }}
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
        image: {{ .Values.global.registry }}/{{ .Values.image.repository }}:{{ .Values.image.tag }}
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
        imagePullPolicy: Always
{{- end }}
        
{{/* Default Template for Service. All Sub-Charts under this Chart can include the below template. */}}
{{- define "datamigrate.servicetemplate" }}
apiVersion: v1
kind: Service
metadata:
  name: {{ .Values.appName }}-service
  labels:
    app: {{ .Values.appName }}
spec:
  type: {{ .Values.service.type }}
  ports:
    - port: {{ .Values.service.port }}
      protocol: TCP
      targetPort: {{ .Values.service.targetPort }}
  selector:
    app: {{ .Values.appName }}
{{- end }}

{{/* Default Template for Ingress. All Sub-Charts under this Chart can include the below template. */}}
{{- define "datamigrate.ingresstemplate" }}
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
      - path: /{{ .Values.ingress.pathPrefix }}{{ .Values.ingress.trailingPath }}
      {{- else }}
      - path: /
      {{- end }}
        pathType: Prefix
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

{{/* Default Template for StatefulSet. All Sub-Charts under this Chart can include the below template. */}}
{{- define "datamigrate.statefulsettemplate" }}
apiVersion: {{ .Values.kubeApiVersion }}
kind: StatefulSet
metadata:
  name: {{ .Values.appName }}
spec:
  replicas: {{ .Values.replicaCount }}
  selector:
    matchLabels:
      app: {{ .Values.appName }}
  serviceName: {{ .Values.appName }}
  template:
    metadata:
      labels:
        app: {{ .Values.appName }}
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
      {{- end }}
      volumes:
      - name: logs-volume
        hostPath:
          path: /logs
      securityContext:
        runAsUser: 1001
        runAsGroup: 1001
        fsGroup: 1001
      containers:
      - name: {{ .Values.appName }}
        image: {{ .Values.global.registry }}/{{ .Values.image.repository }}:{{ .Values.image.tag }}
        command: [{{ .Values.command }}]
        args:
          {{- if .Values.args }}
          - |
            {{ .Values.args }}
          {{- end }}
        envFrom:
        - configMapRef:
            name: kafka-config
        - secretRef:
            name: kafka-secret
        - configMapRef:
            name: kafka-topic-names
        - configMapRef:
            name: mongodb-config
        - configMapRef:
            name: mongodb-db-names
        - secretRef:
            name: mongodb-secret
        - configMapRef:
            name: redis-config
        - secretRef:
            name: redis-secret
        {{- if .Values.envFrom }}
        {{- toYaml .Values.envFrom | nindent 8}}
        {{- end }}
        env:
        - name: LIFECYCLE
          value: "{{ .Values.global.lifecycle }}"
        - name: SERVICE
          value: "{{ .Values.appName }}"
        - name: LOGDIR
          value: "/logs"
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
        volumeMounts:
        - name: logs-volume
          mountPath: /logs
        imagePullPolicy: Always
      imagePullSecrets:
      - name: regcred
      restartPolicy: Always
      terminationGracePeriodSeconds: 10
{{- end }}

{{/* Default Template for HPA. All Sub-Charts under this Chart can include the below template. */}}
{{- define "datamigrate.hpatemplate" }}
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