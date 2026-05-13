# Kubernetes Guestbook with Prometheus and Grafana

This Pulumi program deploys:

- The Guestbook app (`frontend`, `redis-leader`, `redis-replica`)
- Prometheus and Grafana via the `kube-prometheus-stack` Helm chart
- Redis exporter sidecars for backend metrics
- Blackbox probing for frontend HTTP availability and latency metrics

## Prerequisites

- Pulumi CLI installed
- Kubernetes cluster configured in your current `kubectl` context
- Node.js and npm installed

## Deploy Instructions

Run from this directory (`simple/`):

```sh
npm install
pulumi stack init guestbook-monitoring
```

Set required config values:

```sh
pulumi config set isMinikube false
pulumi config set grafanaServiceType LoadBalancer
pulumi config set --secret grafanaAdminPassword "admin123!ChangeMe"
```

If you use `NodePort` for Grafana, also set a node IP:

```sh
pulumi config set grafanaServiceType NodePort
pulumi config set nodeIp <node-ip>
```

Deploy:

```sh
pulumi up
```

## Grafana Access URL and Admin Credentials

Retrieve access details from stack outputs:

```sh
pulumi stack output grafanaUrl
pulumi stack output grafanaAdminUser
pulumi stack output --show-secrets grafanaAdminPasswordOutput
```

Default admin username:

- `admin`

Default admin password:

- Set from `grafanaAdminPassword` Pulumi config

## Verify Guestbook Metrics Are Scraped

Check that monitoring resources exist:

```sh
kubectl -n monitoring get pods
kubectl -n monitoring get servicemonitors
kubectl -n monitoring get probes
```

Open Prometheus UI (example via port-forward):

```sh
kubectl -n monitoring port-forward svc/kube-prom-stack-prometheus 9090:9090
```

Then query these metrics in Prometheus or Grafana Explore:

- `up{job=~".*redis.*"}`
- `redis_up`
- `rate(redis_commands_processed_total[5m])`
- `probe_success{job=~".*frontend-http.*"}`
- `probe_http_duration_seconds`
- `sum by (pod) (rate(container_cpu_usage_seconds_total{namespace="default",pod=~"frontend-.*|redis-.*"}[5m]))`
- `sum by (pod) (container_memory_working_set_bytes{namespace="default",pod=~"frontend-.*|redis-.*"})`

## Optional: Basic Grafana Dashboard

Create a dashboard with these panels:

- Redis command rate (`rate(redis_commands_processed_total[5m])`)
- Frontend probe success (`probe_success{job=~".*frontend-http.*"}`)
- Pod CPU usage for frontend/redis
- Pod memory usage for frontend/redis

![Guestbook in browser](./imgs/guestbook.png)
