# Grafana

The `observability` profile of [Compose](../compose/README.md) loads these files when Grafana starts, so data sources and dashboards live in Git.

| Path | Contents |
| --- | --- |
| `provisioning/datasources/` | Prometheus, Loki, and Tempo, with links from logs to traces and from traces to logs |
| `provisioning/dashboards/` | Where Grafana looks for dashboards |
| `dashboards/` | Dashboards, as JSON |

## Dashboard `POS overview (test data)`
It shows simulated sales until the real services arrive in task F0-11. This command fills it for about two minutes:

```bash
bash scripts/send-test-telemetry.sh
```

| Panel | Question it answers |
| --- | --- |
| Sales per minute, Sales by status | How much traffic is there, and how much of it fails? |
| Error rate | What share of sales fail? |
| p95 sale duration, Sale duration | How slow are the slowest sales, compared with the typical one? |
| Slow sales | Which requests were slow, and where did the time go? |
| Logs | What happened, and which trace does each line belong to? |
| Collector: accepted items per second | Is the telemetry arriving? |
| Collector: delivery problems | Is a store down, and has any data been lost? While a store is down, data waits in a queue. After 5 minutes of retries it is lost |

## Changing a dashboard
Changes made in the browser cannot be saved over a provisioned dashboard. Edit a copy in Grafana, export its JSON, and replace the file in `dashboards/`. Grafana reads the file again within 10 seconds, and the change reaches other people through a pull request.
