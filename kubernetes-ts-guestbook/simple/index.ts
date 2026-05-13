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
const grafanaAdminPassword = config.requireSecret("grafanaAdminPassword");
const nodeIp = config.get("nodeIp");

const monitoringNamespace = new k8s.core.v1.Namespace("monitoring", {
    metadata: { name: "monitoring" },
});

const monitoring = new k8s.helm.v3.Release("kube-prom-stack", {
    chart: "kube-prometheus-stack",
    version: "61.9.0",
    namespace: monitoringNamespace.metadata.name,
    repositoryOpts: { repo: "https://prometheus-community.github.io/helm-charts" },
    timeout: 600,
    // Don't block Pulumi waiting for every pod to be Ready — large charts
    // with components that take time on local clusters (e.g. Docker Desktop)
    // would otherwise time out. Pods are verified separately via kubectl.
    skipAwait: true,
    values: {
        grafana: {
            adminPassword: grafanaAdminPassword,
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
        // node-exporter requires privileged host paths unavailable on Docker Desktop.
        nodeExporter: {
            enabled: false,
        },
        "prometheus-node-exporter": {
            enabled: false,
        },
    },
}, { dependsOn: monitoringNamespace });

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
        labels: redisLeaderDeployment.metadata.labels,
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
        labels: redisReplicaDeployment.metadata.labels,
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
    },
    spec: {
        namespaceSelector: { matchNames: ["default"] },
        selector: { matchLabels: { app: "redis-replica" } },
        endpoints: [{ port: "metrics", interval: "15s", path: "/metrics" }],
    },
}, { dependsOn: monitoring });

// The guestbook frontend image does not expose Prometheus metrics directly.
// Probe the frontend service via blackbox exporter to capture request/availability metrics.
const frontendProbe = new k8s.apiextensions.CustomResource("frontend-probe", {
    apiVersion: "monitoring.coreos.com/v1",
    kind: "Probe",
    metadata: {
        name: "frontend-http",
        namespace: monitoringNamespace.metadata.name,
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

// Export the frontend IP.
export let frontendIp: pulumi.Output<string>;
if (isMinikube) {
    frontendIp = frontendService.spec.clusterIP;
} else {
    frontendIp = frontendService.status.loadBalancer.ingress[0].ip;
}

export const grafanaAdminUser = "admin";
export const grafanaAdminPasswordOutput = grafanaAdminPassword;

// The Grafana service URL is only known after the cluster assigns an IP/NodePort.
// Use the command below after `pulumi up` completes to retrieve it.
export const grafanaUrl = pulumi.output(grafanaServiceType).apply(svcType => {
    const svcName = "kube-prom-stack-grafana";
    const ns = "monitoring";

    if (svcType === "LoadBalancer") {
        return (
            `After deploy, run:\n` +
            `  kubectl get svc ${svcName} -n ${ns} -o jsonpath='{.status.loadBalancer.ingress[0].ip}'\n` +
            `Then open: http://<that-ip>`
        );
    }

    if (svcType === "NodePort") {
        const nodePortCmd = `kubectl get svc ${svcName} -n ${ns} -o jsonpath='{.spec.ports[0].nodePort}'`;
        return nodeIp
            ? `After deploy, run:\n  ${nodePortCmd}\nThen open: http://${nodeIp}:<nodeport>`
            : `After deploy, get nodePort with:\n  ${nodePortCmd}\nThen open: http://<node-ip>:<nodeport>\n(set pulumi config nodeIp to auto-fill the node IP)`;
    }

    return `After deploy, run: kubectl get svc ${svcName} -n ${ns}`;
});

export const monitoringNamespaceName = monitoringNamespace.metadata.name;
export const redisLeaderServiceMonitorName = redisLeaderServiceMonitor.metadata.name;
export const redisReplicaServiceMonitorName = redisReplicaServiceMonitor.metadata.name;
export const frontendProbeName = frontendProbe.metadata.name;
