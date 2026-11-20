# DataInfrastructure_404PorscheNotFound

Codelap Hackathon 2026 – Data-Driven Infrastructure Engineering.

**Project:** Field Device & Mobile Fleet Health Monitoring — an end-to-end solution that captures data from a mobile phone, sends it securely to Azure, processes and stores it in the cloud, and visualizes it in a web dashboard.

## Architecture

```
Phone app ──HTTPS──▶ Azure ingestion & processing ──▶ Database ──▶ Web dashboard
 (capture)            (transmit / process)            (store)       (visualize)
```

## Repository structure

```
DataInfrastructure_404PorscheNotFound/
├── src/
│   ├── mobile-app/        # Phone app: reads raw sensor data, sends JSON events
│   ├── backend/           # Cloud ingestion, processing and query API
│   └── web-dashboard/     # Web UI: device context, latest values, history
├── infrastructure/        # Infrastructure as Code for Azure resources
├── .github/workflows/     # CI/CD pipelines (build & deploy to Azure)
├── presentation/          # Final presentation: DataInfrastructure_404PorscheNotFound.pptx
└── README.md
```

## Setup and installation

_TBD_

## Running the solution

_TBD_

## Dependencies

_TBD_

## Tools and technologies

_TBD_
