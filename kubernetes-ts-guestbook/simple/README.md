# Kubernetes Guestbook with Prometheus and Grafana

Complete infrastructure-as-code deployment of the Kubernetes Guestbook application with Prometheus monitoring and Grafana dashboards via Pulumi.

## Overview

This Pulumi program deploys:

- **Guestbook Application**: Multi-tier app with frontend (PHP), Redis leader, and Redis replicas
- **Prometheus Stack**: Via `kube-prometheus-stack` Helm chart (Prometheus, Grafana, AlertManager)
- **Metrics Collection**:
    - Redis metrics via `oliver006/redis-exporter` sidecars
    - Frontend HTTP availability/latency via Prometheus blackbox exporter
- **Auto-Provisioned Dashboard**: 5-panel Grafana dashboard with live guestbook metrics

## Prerequisites

- **Pulumi CLI**: [Install](https://www.pulumi.com/docs/get-started/install/)
- **Kubernetes Cluster**: Configured in your current `kubectl` context (Docker Desktop, minikube, or cloud K8s)
- **Node.js 18+**: With npm
- **kubectl**: Configured and able to access your cluster

## Deployment Instructions

### 1. Clone/Download the Repository

```bash
git clone <repository-url>
cd kubernetes-ts-guestbook/simple
```

Or extract the provided zip file and navigate to the `simple/` directory.

### 2. Install Dependencies

```bash
npm install
```

### 3. Initialize Pulumi Stack

```bash
pulumi stack init guestbook-monitoring
```

This creates a local deployment configuration. The stack name `guestbook-monitoring` is optional—change it to any name you prefer.

### 4. Configure Required Settings

Set the deployment configuration:

```bash
pulumi config set isMinikube false
pulumi config set grafanaServiceType LoadBalancer
export GRAFANA_PASSWORD="YourSecurePassword123!"
```

**Configuration Options:**

| Config               | Value                        | Description                                                                  |
| -------------------- | ---------------------------- | ---------------------------------------------------------------------------- |
| `isMinikube`         | `true` or `false`            | Set to `true` for minikube clusters (uses ClusterIP instead of LoadBalancer) |
| `grafanaServiceType` | `LoadBalancer` or `NodePort` | How to expose Grafana service                                                |
| `GRAFANA_PASSWORD`   | Any string                   | Admin password for Grafana (read from environment or GitHub Secret)          |
| `nodeIp`             | IP address                   | (Optional) Node IP for NodePort access; used in `grafanaUrl` output          |

**Example for Docker Desktop:**

```bash
pulumi config set isMinikube false
pulumi config set grafanaServiceType LoadBalancer
export GRAFANA_PASSWORD="admin123!ChangeMe"
```

**Example for Minikube:**

```bash
pulumi config set isMinikube true
pulumi config set grafanaServiceType NodePort
pulumi config set nodeIp 192.168.49.2  # Your minikube IP
export GRAFANA_PASSWORD="admin123!ChangeMe"
```

### 5. Deploy

```bash
pulumi up
```

Review the resource plan and press `yes` to deploy. Deployment typically takes 2-3 minutes.

## Accessing Grafana and Credentials

### Retrieve Grafana Access Information

The Grafana username is `admin`.

The Grafana password is injected into Kubernetes via secret `grafana-admin-credentials` (using `GRAFANA_PASSWORD` from environment/GitHub Secrets).

**Username:**

```bash
kubectl -n monitoring get secret grafana-admin-credentials -o jsonpath='{.data.admin-user}' | base64 --decode; echo
```

**Password:**

```bash
kubectl -n monitoring get secret grafana-admin-credentials -o jsonpath='{.data.admin-password}' | base64 --decode; echo
```

If you do not have permission to read Kubernetes secrets, ask the repository owner to share credentials out of band.

**Access URL:**

```bash
pulumi stack output grafanaUrl
# Output will show instructions for your service type (LoadBalancer or NodePort)
```

### Open Grafana Dashboard

**For Docker Desktop or local clusters** (recommended):

If LoadBalancer shows `<pending>`, use port-forwarding:

```bash
kubectl -n monitoring port-forward svc/kube-prom-stack-672aa7d9-grafana 3000:80 &
# Then open: http://localhost:3000
```

**For cloud Kubernetes** (if LoadBalancer IP is assigned):

```bash
kubectl get svc -n monitoring -l app.kubernetes.io/name=grafana -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}'
# Then open: http://<that-ip>:80
```

**For NodePort** (Minikube with NodePort config):

```bash
kubectl get svc -n monitoring -l app.kubernetes.io/name=grafana -o jsonpath='{.items[0].spec.ports[0].nodePort}'
# Then open: http://<node-ip>:<that-port>
```

### About Admin Password Security

**⚠️ DO NOT commit the password to version control.** The README.md file should never contain credentials.

- The password value is sourced from `GRAFANA_PASSWORD` and written to Kubernetes secret `grafana-admin-credentials`
- In CI, store the password in GitHub repository secret `GRAFANA_PASSWORD`
- Never hardcode passwords in README or CI/CD pipelines

**Regarding the Pulumi Passphrase (`PULUMI_CONFIG_PASSPHRASE`):**

- The passphrase is used to **encrypt/decrypt** your Pulumi secrets before storing them
- It is required for Pulumi state encryption/decryption when running `pulumi up` with a local backend
- **Do NOT include** the passphrase in README.md
- If a reviewer runs GitHub Actions, store the passphrase in GitHub secret `PULUMI_CONFIG_PASSPHRASE`
- Store it securely (environment variable, password manager, CI/CD secrets)
- If you lose it, you can re-initialize the stack but will lose encrypted secrets

## Reviewer Setup & Deployment Guide (GitHub Actions)

This repository includes an automated deployment workflow for reviewers: `.github/workflows/reviewer-deploy.yml`.

### Step 1: Set Up Repository Secrets

Repository owners must configure three secrets before reviewers can deploy:

1. Go to repository **Settings → Secrets and variables → Actions**
2. Click **New repository secret** and add these three secrets:

| Secret Name                | Value                                 | Description                                    |
| -------------------------- | ------------------------------------- | ---------------------------------------------- |
| `GRAFANA_PASSWORD`         | Example: `YourSecurePassword123!`     | Admin password for Grafana (set by repo owner) |
| `PULUMI_CONFIG_PASSPHRASE` | Example: `guestbook-monitoring-local` | Encryption passphrase for Pulumi state         |
| `KUBECONFIG_B64`           | Base64-encoded kubeconfig (see below) | Kubernetes cluster config (base64-encoded)     |

**To create `KUBECONFIG_B64`:**

```bash
# Get your kubectl kubeconfig and encode it
cat ~/.kube/config | base64 | pbcopy
# Then paste into GitHub secret
```

Or on Linux:

```bash
cat ~/.kube/config | base64 -w0 | xclip -selection clipboard
```

**⚠️ Security Note:** These secrets are write-only in GitHub UI and only accessible to workflows. Never print them in logs.

### Step 2: Reviewer Triggers Deployment

Reviewers with repository access can now deploy:

1. Go to repository **Actions** tab
2. Select **Reviewer Deploy Guestbook Monitoring** workflow
3. Click **Run workflow**
4. Select branch (`guestbook-monitoring`)
5. Click **Run workflow** button
6. Monitor the workflow execution (typically 3-5 minutes)

### Step 3: Access Grafana After Deployment

After the workflow completes successfully:

**Option A: Get access from workflow output**

1. Click the completed workflow run
2. Read the **workflow output** for `grafanaUrl` and instructions

**Option B: Retrieve credentials manually**

If you have `kubectl` access to the cluster:

Get username:

```bash
kubectl -n monitoring get secret grafana-admin-credentials -o jsonpath='{.data.admin-user}' | base64 --decode; echo
```

Get password:

```bash
kubectl -n monitoring get secret grafana-admin-credentials -o jsonpath='{.data.admin-password}' | base64 --decode; echo
```

Get Grafana URL (local clusters with pending LoadBalancer):

```bash
kubectl -n monitoring port-forward svc/kube-prom-stack-672aa7d9-grafana 3000:80 &
# Then open: http://localhost:3000
```

**Option C: Ask repository owner**

If you don't have kubectl access, ask the repository owner to provide credentials out of band.

### Step 4: Log Into Grafana Dashboard

1. Open Grafana at the URL from Step 3
2. Click **Sign in**
3. Enter credentials:
    - **Username:** `admin`
    - **Password:** (from Step 3)
4. Click **Sign in**
5. Navigate to **Dashboards → Browse**
6. Open **"Guestbook Overview"** dashboard
7. Verify all 5 panels display live metrics

### Reviewer Troubleshooting

**Workflow fails with "secrets not found":**

- Verify all three secrets are set in repository settings
- Check secret names match exactly (case-sensitive)

**Cannot retrieve credentials with kubectl:**

- You may not have read permission for Kubernetes secrets
- Ask repository owner for out-of-band credential sharing

**Grafana dashboard shows "No data":**

- Workflow may still be deploying (takes 2-3 minutes)
- Check that Prometheus targets are scraping (see "Verifying Prometheus Metrics Collection" section)

## Verifying Prometheus Metrics Collection

### Step 1: Check Monitoring Resources

```bash
# View monitoring namespace status
kubectl -n monitoring get pods

# Verify ServiceMonitor resources were created
kubectl -n monitoring get servicemonitors

# Verify Probe resources for HTTP probing
kubectl -n monitoring get probes
```

Expected output includes pods like:

- `kube-prom-stack-*-prometheus-*`
- `kube-prom-stack-grafana-*`
- `blackbox-exporter-*`

### Step 2: Open Prometheus UI

Access Prometheus to verify targets are being scraped:

```bash
# Port-forward Prometheus service
kubectl -n monitoring port-forward svc/kube-prom-stack-672aa7d9-k-prometheus 9090:9090
# URL: http://localhost:9090
```

In Prometheus UI:

1. Go to **Status → Targets**
2. Verify all three jobs show **(1/1 up)**:
    - `redis-leader`
    - `redis-replica`
    - `probe/monitoring/frontend-http`

### Step 3: Query Metrics

In Prometheus **Graph** tab, test these queries:

```promql
# Check all targets are up
up{job=~".*redis.*|.*frontend-http.*"}

# Redis command rate
rate(redis_commands_processed_total{namespace="default"}[5m])

# Frontend probe success percentage
100 * avg_over_time(probe_success{job=~".*frontend-http.*"}[5m])

# Frontend probe duration
probe_duration_seconds{job=~".*frontend-http.*"}

# Pod CPU usage
sum by (pod) (rate(container_cpu_usage_seconds_total{namespace="default",pod=~"frontend-.*|redis-.*"}[5m]))

# Pod memory usage
sum by (pod) (container_memory_working_set_bytes{namespace="default",pod=~"frontend-.*|redis-.*"})
```

### Step 4: View Auto-Provisioned Grafana Dashboard

The stack automatically provisions a "Guestbook Overview" dashboard with 5 panels:

1. **Redis Command Rate** - Commands processed per second
2. **Frontend Probe Success** - HTTP availability as percentage
3. **Frontend Probe Duration** - HTTP response time in seconds
4. **Pod CPU Usage** - CPU cores consumed by each pod
5. **Pod Memory Usage** - Memory (bytes) for each pod

In Grafana UI:

1. Log in with `admin` user and your configured password
2. Click **Dashboards → Browse**
3. Find and open **"Guestbook Overview"**
4. Verify all 5 panels show data (no "No data" errors)

## Cleanup

### Destroy the Deployment

```bash
pulumi destroy
```

This removes all Kubernetes resources created by Pulumi.

### (Optional) Remove Local State

```bash
rm -rf .pulumi-local
```

**⚠️ Warning:** This permanently deletes your Pulumi state files. Only do this if you won't need to manage the stack again.

## Troubleshooting

### Dashboard Panels Show "No data"

**Check Prometheus targets:**

```bash
kubectl -n monitoring logs -l app.kubernetes.io/name=prometheus --tail=50
```

**Verify ServiceMonitors:**

```bash
kubectl -n monitoring get servicemonitor redis-leader -o yaml
```

### Grafana Login Fails

**Retrieve the correct password:**

```bash
kubectl -n monitoring get secret grafana-admin-credentials -o jsonpath='{.data.admin-password}' | base64 --decode; echo
```

**Reset password in Grafana pod:**

```bash
kubectl -n monitoring exec -it $(kubectl -n monitoring get pods -l app.kubernetes.io/name=grafana -o name | head -1) -- grafana-cli admin reset-admin-password newpassword
```

### Blackbox Exporter Not Found

**Check blackbox-exporter Helm release:**

```bash
helm list -n monitoring
kubectl -n monitoring get pods | grep blackbox
```

## File Structure

```
simple/
├── README.md          (This file)
├── index.ts           (Pulumi IaC code)
├── package.json       (Node.js dependencies)
├── tsconfig.json      (TypeScript config)
├── Pulumi.yaml        (Pulumi metadata)
└── imgs/
    └── guestbook.png  (Architecture diagram)
```

## Repository Contents

- **Code**: Full TypeScript Pulumi program with monitoring stack
- **.gitignore**: Excludes Pulumi state and secrets (already configured)
- **This README**: Deployment and access instructions

## Additional Resources

- [Pulumi Documentation](https://www.pulumi.com/docs/)
- [kube-prometheus-stack Helm Chart](https://github.com/prometheus-community/helm-charts/tree/main/charts/kube-prometheus-stack)
- [Prometheus Operator](https://prometheus-operator.dev/)
- [Grafana Documentation](https://grafana.com/docs/)
