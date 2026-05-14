# Kubernetes Guestbook with Prometheus and Grafana (Local Development)

**⚠️ LOCAL ENVIRONMENT ONLY**: This guide is for running the Guestbook application with monitoring stack on your local Docker Desktop Kubernetes cluster. For cloud deployments, modify the configuration accordingly.

## Overview

This Pulumi program deploys to your local Docker Desktop Kubernetes:

- **Guestbook Application**: Multi-tier app with frontend (PHP), Redis leader, and Redis replicas
- **Prometheus Stack**: Via `kube-prometheus-stack` Helm chart (Prometheus, Grafana, AlertManager)
- **Metrics Collection**:
    - Redis metrics via `oliver006/redis-exporter` sidecars
    - Frontend HTTP availability/latency via Prometheus blackbox exporter
- **Auto-Provisioned Dashboard**: 5-panel Grafana dashboard with live guestbook metrics

## Prerequisites

- **Docker Desktop**: [Install](https://www.docker.com/products/docker-desktop) with Kubernetes enabled
- **kubectl**: Pre-installed with Docker Desktop
- **Pulumi CLI**: [Install](https://www.pulumi.com/docs/get-started/install/)
- **Node.js 18+**: With npm

## Setup Docker Desktop Kubernetes

**Skip this if Kubernetes is already enabled.**

1. Open **Docker Desktop** → **Settings/Preferences**
2. Go to **Kubernetes** tab
3. Check **Enable Kubernetes**
4. Click **Apply & Restart** and wait 2-3 minutes for Kubernetes to start

Verify it's running:

```bash
kubectl cluster-info
# Should show: Kubernetes control plane is running at https://kubernetes.docker.internal:6443
```

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

### 3. Create Pulumi Local Stack

```bash
# Create a local Pulumi backend directory
mkdir -p .pulumi-local

# Initialize the stack
pulumi login "file://$(pwd)/.pulumi-local"
pulumi stack init guestbook-monitoring
```

### 4. Configure for Local Docker Desktop

Set the required configuration:

```bash
# For Docker Desktop (recommended)
pulumi config set isMinikube false
pulumi config set grafanaServiceType LoadBalancer

# Set secrets without hardcoding values in files/shell history (zsh)
read -s "GRAFANA_PASSWORD?Grafana admin password: "; echo
read -s "PULUMI_CONFIG_PASSPHRASE?Pulumi config passphrase: "; echo
export GRAFANA_PASSWORD
export PULUMI_CONFIG_PASSPHRASE

# If using bash instead of zsh:
# read -s -p "Grafana admin password: " GRAFANA_PASSWORD; echo
# read -s -p "Pulumi config passphrase: " PULUMI_CONFIG_PASSPHRASE; echo

# Optional: sync the same values to GitHub Actions secrets
# Install GitHub CLI on macOS if needed: brew install gh
# Authenticate once: gh auth login
gh secret set GRAFANA_PASSWORD --body "$GRAFANA_PASSWORD"
gh secret set PULUMI_CONFIG_PASSPHRASE --body "$PULUMI_CONFIG_PASSPHRASE"
```

Note: GitHub Actions secrets are write-only. You can set or update them, but you cannot read secret values back from GitHub to your local machine. If you need local and CI to share the same values, keep a local source of truth (password manager or local env file) and push to GitHub with `gh secret set`.

If you do not want to install `gh`, set the same secrets manually in GitHub UI:
`Settings` -> `Secrets and variables` -> `Actions` -> `New repository secret`.

**Configuration Options:**

| Config                     | Value          | Description                                         |
| -------------------------- | -------------- | --------------------------------------------------- |
| `isMinikube`               | `false`        | Set to `false` for Docker Desktop                   |
| `grafanaServiceType`       | `LoadBalancer` | How to expose Grafana (use LoadBalancer for Docker) |
| `GRAFANA_PASSWORD`         | Any string     | Admin password for Grafana (set as env var)         |
| `PULUMI_CONFIG_PASSPHRASE` | Any string     | Encryption key for local Pulumi state               |

### 5. Deploy

```bash
pulumi up
```

Review the resource plan and press `yes` to deploy. Deployment typically takes 2-3 minutes.

## Sharing Access with Local Reviewers

## Accessing Grafana Locally

### Get Admin Credentials

**Username:**

```bash
kubectl -n monitoring get secret grafana-admin-credentials -o jsonpath='{.data.admin-user}' | base64 --decode; echo
# Output: admin
```

**Password:**

```bash
kubectl -n monitoring get secret grafana-admin-credentials -o jsonpath='{.data.admin-password}' | base64 --decode; echo
# Output: (the GRAFANA_PASSWORD you set earlier)
```

### Access Grafana via Port Forwarding

Run this command in a terminal:

```bash
kubectl -n monitoring port-forward svc/grafana 3000:80
```

You should see:

```
Forwarding from 127.0.0.1:3000 -> 3000
```

Then open your web browser to: **http://localhost:3000**

### Log In to Grafana

1. Open **http://localhost:3000** in your browser
2. Click **Sign in**
3. Enter credentials:
    - **Username:** `admin`
    - **Password:** (from the command above)
4. Click **Sign in**
5. Navigate to **Dashboards → Browse**
6. Open **"Guestbook Overview"** dashboard
7. Verify all 5 panels display live metrics

### Sharing with Other Reviewers on Your Network

If reviewers are on the same machine, they can use the same `kubectl port-forward` command.

If reviewers are on a different machine and you want to share:

**Option 1: Temporary tunnel with ngrok**

```bash
# Install ngrok: https://ngrok.com/download
ngrok http 3000
# Share the URL with reviewers (valid for 2 hours)
```

**Option 2: SSH tunnel to your machine**

```bash
# On reviewer's machine:
ssh -L 3000:localhost:3000 user@your-machine-ip
# Then open http://localhost:3000
```

## About Admin Password Security

**⚠️ DO NOT commit the password to version control.** The README.md file should never contain credentials.

- Keep `GRAFANA_PASSWORD` and `PULUMI_CONFIG_PASSPHRASE` as **environment variables only**
- Store them in your shell profile (`.zshrc`, `.bashrc`, etc.) locally, never in git
- When sharing with reviewers, provide the password **out of band** (Slack, email, secure note app)
- If a reviewer needs to repeat the deployment, they must set their own password

## Verifying Prometheus Metrics Collection (Advanced)

### Check Monitoring Resources Are Running

```bash
# View all monitoring namespace resources
kubectl -n monitoring get all

# View live pod status
kubectl -n monitoring get pods -w  # Press Ctrl+C to exit
```

Expected pods:

- `kube-prom-stack-prometheus-*`
- `kube-prom-stack-grafana-*`
- `grafana-*`
- `blackbox-exporter-*`

### Access Prometheus UI Directly

```bash
# Forward Prometheus port
kubectl -n monitoring port-forward svc/kube-prom-stack-prometheus 9090:9090 &

# Open in browser: http://localhost:9090
```

In Prometheus UI:

1. Go to **Status → Targets**
2. Verify all three jobs show **(1/1 up)**:
    - `redis-leader`
    - `redis-replica`
    - `probe/monitoring/frontend-http`

### Test PromQL Queries

In Prometheus **Graph** tab, run these queries to verify metrics:

```promql
# Check all targets are up
up{job=~".*redis.*|.*frontend-http.*"}

# Redis command rate
rate(redis_commands_processed_total{namespace="default"}[5m])

# Frontend HTTP success rate
100 * avg_over_time(probe_success{job=~".*frontend-http.*"}[5m])

# Frontend response time
probe_duration_seconds{job=~".*frontend-http.*"}
```

## Cleanup

### Stop Port Forwarding Sessions

Kill any background port-forward processes:

```bash
# Kill all port-forward sessions
pkill -f "kubectl.*port-forward" || true
```

### Destroy the Deployment

```bash
pulumi destroy
```

Review the resources to be deleted and press `yes`. This removes all Kubernetes resources created by Pulumi.

### (Optional) Remove Local Pulumi State

```bash
# This permanently deletes all Pulumi state and stack information
rm -rf .pulumi-local
# Remove the stack reference
pulumi stack rm guestbook-monitoring
```

**⚠️ Warning:** This is irreversible. Only do this if you won't need to manage this stack again.

## Troubleshooting

### Dashboard Panels Show "No data"

Data may take 1-2 minutes to appear after deployment. If still empty:

**Check Prometheus is scraping targets:**

```bash
kubectl -n monitoring port-forward svc/kube-prom-stack-prometheus 9090:9090 &
# Then open http://localhost:9090
# Go to Status → Targets
# Verify all three jobs show (1/1 up):
#  - redis-leader
#  - redis-replica
#  - probe/monitoring/frontend-http
```

**Check Prometheus logs:**

```bash
kubectl -n monitoring logs -l app.kubernetes.io/name=prometheus --tail=50
```

### Grafana Login Fails / Wrong Password

**Reset the admin password:**

```bash
# Get the Grafana pod name
POD=$(kubectl -n monitoring get pods -l app.kubernetes.io/name=grafana -o name | head -1)

# Reset password to 'newpassword' (change this!)
kubectl -n monitoring exec -it $POD -- grafana-cli admin reset-admin-password newpassword

# Then log in with username: admin, password: newpassword
```

### Kubernetes shows "kubectl not found"

Ensure Docker Desktop Kubernetes is enabled:

1. Open **Docker Desktop** → **Settings/Preferences**
2. Go to **Kubernetes** tab
3. Check **Enable Kubernetes**
4. Verify: `kubectl cluster-info`

### Cannot connect to Kubernetes API

Docker Desktop Kubernetes may have crashed. Restart it:

```bash
# Restart the entire Docker Desktop application
pkill Docker  # macOS only
# Then reopen Docker Desktop and wait 2-3 minutes for Kubernetes to boot
```

Or check Docker Desktop logs for errors.

## Auto-Provisioned Grafana Dashboard

The stack automatically creates and provisions a **"Guestbook Overview"** dashboard with 5 panels:

1. **Redis Command Rate** — Commands processed per second
2. **Frontend HTTP Success Rate** — HTTP availability as percentage
3. **Frontend Response Time** — HTTP response time in seconds (p99)
4. **Pod CPU Usage** — CPU cores consumed by each pod
5. **Pod Memory Usage** — Memory (MB) for each pod

**To view the dashboard:**

1. Log in to Grafana (see [Accessing Grafana](#accessing-grafana-locally))
2. Click **Dashboards → Browse**
3. Find and open **"Guestbook Overview"**
4. Verify all 5 panels show live data

If panels show "No data", wait 1-2 minutes for Prometheus to collect initial metrics.

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

- [Docker Desktop Kubernetes Docs](https://docs.docker.com/desktop/kubernetes/)
- [Pulumi Documentation](https://www.pulumi.com/docs/)
- [kube-prometheus-stack Helm Chart](https://github.com/prometheus-community/helm-charts/tree/main/charts/kube-prometheus-stack)
- [Prometheus Documentation](https://prometheus.io/docs/)
- [Grafana Documentation](https://grafana.com/docs/)
