// Copyright 2016-2025, Pulumi Corporation.  All rights reserved.

import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";

// Minikube does not implement services of type `LoadBalancer`; require the user to specify if we're
// running on minikube, and if so, create only services of type ClusterIP.
const config = new pulumi.Config();
const isMinikube = config.getBoolean("isMinikube") ?? true;
const grafanaServiceTypeConfig = config.get("grafanaServiceType");
const grafanaServiceType =
    grafanaServiceTypeConfig === "NodePort" || grafanaServiceTypeConfig === "LoadBalancer"
        ? grafanaServiceTypeConfig
        : isMinikube
          ? "NodePort"
          : "LoadBalancer";
const grafanaAdminPassword = process.env.GRAFANA_PASSWORD
        ? pulumi.secret(process.env.GRAFANA_PASSWORD)
        : config.requireSecret("grafanaAdminPassword");
const nodeIp = config.get("nodeIp");

const monitoringNamespace = new k8s.core.v1.Namespace("monitoring", {
    metadata: { name: "monitoring" },
});

const grafanaAdminSecret = new k8s.core.v1.Secret("grafana-admin-credentials", {
    metadata: {
        name: "grafana-admin-credentials",
        namespace: monitoringNamespace.metadata.name,
    },
    stringData: {
        "admin-user": "admin",
        "admin-password": grafanaAdminPassword,
    },
    type: "Opaque",
}, { dependsOn: monitoringNamespace });

const monitoring = new k8s.helm.v3.Release("kube-prom-stack", {
    chart: "kube-prometheus-stack",
    version: "61.9.0",
    namespace: monitoringNamespace.metadata.name,
    repositoryOpts: { repo: "https://prometheus-community.github.io/helm-charts" },
    timeout: 600,
    skipAwait: true,
    values: {
        grafana: {
            admin: {
                existingSecret: grafanaAdminSecret.metadata.name,
                userKey: "admin-user",
                passwordKey: "admin-password",
            },
            service: {
                type: grafanaServiceType,
            },
        },
        prometheus: {
            prometheusSpec: {
                serviceMonitorSelector: {},
                serviceMonitorNamespaceSelector: {},
                probeSelector: {},
                probeNamespaceSelector: {},
            },
        },
        nodeExporter: {
            enabled: false,
        },
        "prometheus-node-exporter": {
            enabled: false,
        },
    },
}, { dependsOn: [monitoringNamespace, grafanaAdminSecret] });

const blackboxExporter = new k8s.helm.v3.Release("blackbox-exporter", {
    chart: "prometheus-blackbox-exporter",
    namespace: monitoringNamespace.metadata.name,
    repositoryOpts: { repo: "https://prometheus-community.github.io/helm-charts" },
    values: {
        fullnameOverride: "blackbox-exporter",
    },
}, { dependsOn: monitoringNamespace });

//
// REDIS LEADER.
//

const redisLeaderLabels = { app: "redis-leader" };
const redisLeaderDeployment = new k8s.apps.v1.Deployment("redis-leader", {
    spec: {
        selector: { matchLabels: redisLeaderLabels },
        template: {
            metadata: { labels: redisLeaderLabels },
            spec: {
                containers: [
                    {
                        name: "redis-leader",
                        image: "redis",
                        resources: { requests: { cpu: "100m", memory: "100Mi" } },
                        ports: [{ containerPort: 6379 }],
                    },
                    {
                        name: "redis-exporter",
                        image: "oliver006/redis_exporter:v1.63.0",
                        args: ["--redis.addr=redis://localhost:6379"],
                        ports: [{ containerPort: 9121 }],
                    },
                ],
            },
        },
    },
});
const redisLeaderService = new k8s.core.v1.Service("redis-leader", {
    metadata: {
        name: "redis-leader",
        labels: {
            app: "redis-leader",
        },
    },
    spec: {
        ports: [
            { name: "redis", port: 6379, targetPort: 6379 },
            { name: "metrics", port: 9121, targetPort: 9121 },
        ],
        selector: redisLeaderDeployment.spec.template.metadata.labels,
    },
});

//
// REDIS REPLICA.
//

const redisReplicaLabels = { app: "redis-replica" };
const redisReplicaDeployment = new k8s.apps.v1.Deployment("redis-replica", {
    spec: {
        selector: { matchLabels: redisReplicaLabels },
        template: {
            metadata: { labels: redisReplicaLabels },
            spec: {
                containers: [
                    {
                        name: "replica",
                        image: "pulumi/guestbook-redis-replica",
                        resources: { requests: { cpu: "100m", memory: "100Mi" } },
                        // If your cluster config does not include a dns service, then to instead access an environment
                        // variable to find the leader's host, change `value: "dns"` to read `value: "env"`.
                        env: [{ name: "GET_HOSTS_FROM", value: "dns" }],
                        ports: [{ containerPort: 6379 }],
                    },
                    {
                        name: "redis-exporter",
                        image: "oliver006/redis_exporter:v1.63.0",
                        args: ["--redis.addr=redis://localhost:6379"],
                        ports: [{ containerPort: 9121 }],
                    },
                ],
            },
        },
    },
});
const redisReplicaService = new k8s.core.v1.Service("redis-replica", {
    metadata: {
        name: "redis-replica",
        labels: {
            app: "redis-replica",
        },
    },
    spec: {
        ports: [
            { name: "redis", port: 6379, targetPort: 6379 },
            { name: "metrics", port: 9121, targetPort: 9121 },
        ],
        selector: redisReplicaDeployment.spec.template.metadata.labels,
    },
});

//
// FRONTEND
//

const frontendLabels = { app: "frontend" };
const frontendDeployment = new k8s.apps.v1.Deployment("frontend", {
    spec: {
        selector: { matchLabels: frontendLabels },
        replicas: 3,
        template: {
            metadata: { labels: frontendLabels },
            spec: {
                containers: [
                    {
                        name: "frontend",
                        image: "pulumi/guestbook-php-redis",
                        resources: { requests: { cpu: "100m", memory: "100Mi" } },
                        // If your cluster config does not include a dns service, then to instead access an environment
                        // variable to find the master service's host, change `value: "dns"` to read `value: "env"`.
                        env: [{ name: "GET_HOSTS_FROM", value: "dns" /* value: "env"*/ }],
                        ports: [{ containerPort: 80 }],
                    },
                ],
            },
        },
    },
});
const frontendService = new k8s.core.v1.Service("frontend", {
    metadata: {
        labels: frontendDeployment.metadata.labels,
        name: "frontend",
    },
    spec: {
        type: isMinikube ? "ClusterIP" : "LoadBalancer",
        ports: [{ name: "http", port: 80, targetPort: 80 }],
        selector: frontendDeployment.spec.template.metadata.labels,
    },
});

const redisLeaderServiceMonitor = new k8s.apiextensions.CustomResource("redis-leader-service-monitor", {
    apiVersion: "monitoring.coreos.com/v1",
    kind: "ServiceMonitor",
    metadata: {
        name: "redis-leader",
        namespace: monitoringNamespace.metadata.name,
        labels: {
            release: monitoring.status.name,
        },
    },
    spec: {
        namespaceSelector: { matchNames: ["default"] },
        selector: { matchLabels: { app: "redis-leader" } },
        endpoints: [{ port: "metrics", interval: "15s", path: "/metrics" }],
    },
}, { dependsOn: monitoring });

const redisReplicaServiceMonitor = new k8s.apiextensions.CustomResource("redis-replica-service-monitor", {
    apiVersion: "monitoring.coreos.com/v1",
    kind: "ServiceMonitor",
    metadata: {
        name: "redis-replica",
        namespace: monitoringNamespace.metadata.name,
        labels: {
            release: monitoring.status.name,
        },
    },
    spec: {
        namespaceSelector: { matchNames: ["default"] },
        selector: { matchLabels: { app: "redis-replica" } },
        endpoints: [{ port: "metrics", interval: "15s", path: "/metrics" }],
    },
}, { dependsOn: monitoring });

const frontendProbe = new k8s.apiextensions.CustomResource("frontend-probe", {
    apiVersion: "monitoring.coreos.com/v1",
    kind: "Probe",
    metadata: {
        name: "frontend-http",
        namespace: monitoringNamespace.metadata.name,
        labels: {
            release: monitoring.status.name,
        },
    },
    spec: {
        interval: "30s",
        module: "http_2xx",
        prober: {
            url: "blackbox-exporter.monitoring.svc.cluster.local:9115",
        },
        targets: {
            staticConfig: {
                static: ["http://frontend.default.svc.cluster.local"],
            },
        },
    },
}, { dependsOn: [monitoring, blackboxExporter] });

const frontendApiProbe = new k8s.apiextensions.CustomResource("frontend-api-probe", {
    apiVersion: "monitoring.coreos.com/v1",
    kind: "Probe",
    metadata: {
        name: "guestbook-get-call",
        namespace: monitoringNamespace.metadata.name,
        labels: {
            release: monitoring.status.name,
        },
    },
    spec: {
        interval: "15s",
        module: "http_2xx",
        prober: {
            url: "blackbox-exporter.monitoring.svc.cluster.local:9115",
        },
        targets: {
            staticConfig: {
                static: ["http://frontend.default.svc.cluster.local/guestbook.php?cmd=get&key=messages"],
            },
        },
    },
}, { dependsOn: [monitoring, blackboxExporter] });

const guestbookDashboard = {
    uid: "guestbook-overview",
    title: "Guestbook Overview",
    timezone: "browser",
    schemaVersion: 39,
    version: 1,
    refresh: "30s",
    time: {
        from: "now-1h",
        to: "now",
    },
    tags: ["guestbook", "pulumi"],
    annotations: {
        list: [
            {
                builtIn: 1,
                datasource: {
                    type: "grafana",
                    uid: "-- Grafana --",
                },
                enable: true,
                hide: true,
                iconColor: "rgba(0, 211, 255, 1)",
                name: "Annotations & Alerts",
                type: "dashboard",
            },
        ],
    },
    templating: {
        list: [],
    },
    panels: [
        {
            id: 1,
            type: "timeseries",
            title: "Redis Command Rate (ops/s)",
            datasource: "Prometheus",
            gridPos: { h: 8, w: 12, x: 0, y: 0 },
            targets: [
                {
                    expr: "sum(rate(redis_commands_processed_total{namespace=\"default\"}[5m]))",
                    legendFormat: "total",
                    refId: "A",
                },
            ],
        },
        {
            id: 2,
            type: "stat",
            title: "Guestbook API Success (5m avg)",
            datasource: "Prometheus",
            gridPos: { h: 8, w: 6, x: 12, y: 0 },
            targets: [
                {
                    expr: "100 * avg_over_time(probe_success{job=~\".*guestbook-get-call.*\"}[5m])",
                    refId: "A",
                },
            ],
            options: {
                reduceOptions: { calcs: ["lastNotNull"], fields: "", values: false },
                orientation: "auto",
                textMode: "value",
                colorMode: "value",
                graphMode: "area",
                justifyMode: "auto",
            },
            fieldConfig: {
                defaults: {
                    unit: "percent",
                    decimals: 2,
                    thresholds: {
                        mode: "absolute",
                        steps: [
                            { color: "red", value: 0 },
                            { color: "orange", value: 90 },
                            { color: "green", value: 100 },
                        ],
                    },
                },
                overrides: [],
            },
        },
        {
            id: 3,
            type: "timeseries",
            title: "Guestbook API Duration (s)",
            datasource: "Prometheus",
            gridPos: { h: 8, w: 6, x: 18, y: 0 },
            targets: [
                {
                    expr: "avg_over_time(probe_duration_seconds{job=~\".*guestbook-get-call.*\"}[5m])",
                    legendFormat: "guestbook-api",
                    refId: "A",
                },
            ],
        },
        {
            id: 6,
            type: "timeseries",
            title: "Guestbook API Successful Requests (5m)",
            datasource: "Prometheus",
            gridPos: { h: 8, w: 24, x: 0, y: 16 },
            targets: [
                {
                    expr: "sum(sum_over_time(probe_success{job=~\".*guestbook-get-call.*\"}[5m]))",
                    legendFormat: "successful_probe_requests",
                    refId: "A",
                },
            ],
        },
        {
            id: 4,
            type: "timeseries",
            title: "Pod CPU Usage (cores)",
            datasource: "Prometheus",
            gridPos: { h: 8, w: 12, x: 0, y: 8 },
            targets: [
                {
                    expr: "sum by (pod) (rate(container_cpu_usage_seconds_total{namespace=\"default\",pod=~\"frontend-.*|redis-.*\"}[5m]))",
                    legendFormat: "{{pod}}",
                    refId: "A",
                },
            ],
        },
        {
            id: 5,
            type: "timeseries",
            title: "Pod Memory Usage (bytes)",
            datasource: "Prometheus",
            gridPos: { h: 8, w: 12, x: 12, y: 8 },
            targets: [
                {
                    expr: "sum by (pod) (container_memory_working_set_bytes{namespace=\"default\",pod=~\"frontend-.*|redis-.*\"})",
                    legendFormat: "{{pod}}",
                    refId: "A",
                },
            ],
            fieldConfig: {
                defaults: {
                    unit: "bytes",
                },
                overrides: [],
            },
        },
    ],
};

const guestbookDashboardConfigMap = new k8s.core.v1.ConfigMap("guestbook-grafana-dashboard", {
    metadata: {
        name: "guestbook-overview-dashboard",
        namespace: monitoringNamespace.metadata.name,
        labels: {
            grafana_dashboard: "1",
        },
    },
    data: {
        "guestbook-overview.json": JSON.stringify(guestbookDashboard, null, 2),
    },
}, { dependsOn: monitoring });

// Export the frontend IP.
export let frontendIp: pulumi.Output<string>;
if (isMinikube) {
    frontendIp = frontendService.spec.clusterIP;
} else {
    frontendIp = frontendService.status.loadBalancer.ingress[0].ip;
}

export const grafanaAdminUser = "admin";
export const grafanaAdminPasswordOutput = grafanaAdminPassword;

export const grafanaUrl = pulumi.output(grafanaServiceType).apply(svcType => {
    const ns = "monitoring";
    const selector = "-l app.kubernetes.io/name=grafana";

    if (svcType === "LoadBalancer") {
        return (
            `After deploy, Grafana will be available at:\n` +
            `1. Check service: kubectl get svc -n ${ns} ${selector}\n` +
            `2. Get IP: kubectl get svc -n ${ns} ${selector} -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}'\n` +
            `3. If <pending>, use port-forward: kubectl -n ${ns} port-forward svc/GRAFANA_SVC 3000:80\n` +
            `4. Open http://localhost:3000\nUsername: admin`
        );
    }

    if (svcType === "NodePort") {
        return nodeIp
            ? `Get NodePort: kubectl get svc -n ${ns} ${selector} -o jsonpath='{.items[0].spec.ports[0].nodePort}'\nOpen: http://${nodeIp}:<nodeport>`
            : `Get NodePort: kubectl get svc -n ${ns} ${selector} -o jsonpath='{.items[0].spec.ports[0].nodePort}'\nOpen: http://<node-ip>:<nodeport>`;
    }

    return "Unknown service type";
});

export const monitoringNamespaceName = monitoringNamespace.metadata.name;
export const redisLeaderServiceMonitorName = redisLeaderServiceMonitor.metadata.name;
export const redisReplicaServiceMonitorName = redisReplicaServiceMonitor.metadata.name;
export const frontendProbeName = frontendProbe.metadata.name;
export const frontendApiProbeName = frontendApiProbe.metadata.name;
export const grafanaDashboardName = guestbookDashboardConfigMap.metadata.name;
export const grafanaDashboardUid = guestbookDashboard.uid;
