# DataInfrastructure_404PorscheNotFound

Codelap Hackathon 2026 – Data-Driven Infrastructure Engineering.

**Project:** Field Device & Mobile Fleet Health Monitoring — an end-to-end solution that captures data from a mobile phone, sends it securely to AWS, processes and stores it in the cloud, and visualizes it in a web dashboard.

## Architecture

```mermaid
flowchart LR
    phone["📱 Phone app<br/>(Flutter)"] -- "HTTPS + x-api-key" --> api["API Gateway"]
    api --> ingest["λ ingest"] --> sqs[["SQS FIFO"]] --> processor["λ processor"] --> db[("DynamoDB")]
    api --> events["λ battery / connectivity"] --> db
    browser["🖥️ Web dashboard<br/>(S3 + CloudFront)"] -- "GET /api/devices..." --> api --> query["λ query"] --> db
```

The AWS resources are defined with **AWS CDK (TypeScript)** as four independently deployable
stacks (web, data, lambdas, api) and deployed by **GitHub Actions** via OIDC (no stored AWS keys).

**Full documentation:** [docs/infrastructure.md](docs/infrastructure.md) – architecture,
stacks, workflows, configuration, how to deploy and troubleshoot.

## Repository structure

```
DataInfrastructure_404PorscheNotFound/
├── src/
│   ├── mobile-app/tele/   # Flutter phone app: reads battery/charging/acceleration, sends JSON events
│   ├── backend/           # Python Lambda handlers (ingest, processor, query, battery, connectivity) + tests
│   └── web-dashboard/     # React + Vite dashboard: device list, latest values, history
├── infrastructure/        # AWS CDK app (TypeScript)
│   ├── bin/app.ts         # Stack wiring and deploy order
│   └── lib/
│       ├── stacks/        # WebStack, DataStack, LambdaStack, ApiStack
│       ├── constructs/    # Reusable building blocks used by the stacks
│       └── naming.ts      # Fixed resource names shared by the stacks
├── .github/workflows/     # CI/CD, prefixed by area: infra-*, web-*, mobile-*
├── .github/actions/       # Shared workflow steps: setup-cdk, aws-login
├── .github/scripts/       # affected_lambdas.py: which Lambdas a change affects
├── docs/                  # Infrastructure and deployment documentation
├── presentation/          # Final presentation: DataInfrastructure_404PorscheNotFound.pptx
└── README.md
```

## Setup and installation

1. One-time AWS setup (bootstrap + GitHub deploy role): [docs/infrastructure.md § 5.1](docs/infrastructure.md#51-first-time-setup-of-a-new-aws-account).
2. Create the GitHub environments with required reviewers ([docs/infrastructure.md § 4](docs/infrastructure.md#github-environments-settings--environments)).
3. Merge to `main` (or run the workflows by hand). The dashboard deploys automatically; each stack and each Lambda waits for your approval in **Infra / Deploy stacks and Lambdas**.
4. Set the `INGESTION_URL` variable and `INGESTION_API_KEY` secret, then run **Mobile / APK build** and install the APK on the phones.

Component-specific setup: [src/web-dashboard/README.md](src/web-dashboard/README.md),
[src/mobile-app/tele/README.md](src/mobile-app/tele/README.md).

## Running the solution

- **Dashboard:** `DashboardUrl` output of the `fleet-telemetry-web` stack (also in the Web / Dashboard deploy run summary).
- **Phone:** install the APK from the **Mobile / APK build** run's artifacts; it starts sending every 5 s.
- **API check:** open `<ApiBaseUrl>/api/devices` in a browser.

## Dependencies

| Part | Needs |
|---|---|
| Infrastructure | Node 22, AWS CDK 2 (installed by `npm ci` in `infrastructure/`) |
| Backend | Python 3.13 (Lambda runtime), boto3 (provided by Lambda) |
| Dashboard | Node 22, Vite |
| Mobile app | Flutter stable, Java 17, Android SDK |

## Tools and technologies

AWS (API Gateway, Lambda, SQS FIFO, DynamoDB, S3, CloudFront, SSM, CloudWatch, IAM/OIDC),
AWS CDK (TypeScript), Python, React + Vite, Flutter, GitHub Actions.
