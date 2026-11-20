# Backend Lambdas — developer spec

This folder holds the Python code of the three AWS Lambda functions. The infrastructure
(API Gateway, SQS, DynamoDB, the Lambdas themselves) is defined with AWS CDK in
[`infrastructure/`](../../infrastructure). You only change the Python code here; the
business rules (validation, calculations, alerts) come from the contracts guide
(Contract A, B, C and **Track 2**).

```
Phone ──POST /api/telemetry──▶ API Gateway ──▶ ingest.py ──▶ SQS FIFO ──▶ processor.py ──▶ DynamoDB
                               (checks x-api-key)                │                          (2 tables)
                                                                 └─▶ DLQ after 3 failures
Dashboard ──GET /api/devices[/{id}/telemetry]──▶ API Gateway ──▶ query.py ──▶ DynamoDB
```

## 1. Files and what you own

| File | Lambda | Trigger | Status |
|---|---|---|---|
| `handlers/ingest.py` | `fleet-telemetry-ingest` | `POST /api/telemetry` | Works; add full validation |
| `handlers/processor.py` | `fleet-telemetry-processor` | SQS FIFO queue | Batch/retry handling done; **implement `process_events`** |
| `handlers/query.py` | `fleet-telemetry-query` | `GET /api/devices`, `GET /api/devices/{deviceId}/telemetry` | Reads DynamoDB; **shape responses to Contract C** |

You may add new modules (e.g. `handlers/rules.py`, `handlers/validation.py`) and import
them — the whole `src/backend` folder is deployed with every function.

## 2. Fixed by the infrastructure (talk to the infra owner before changing)

| Item | Value |
|---|---|
| Runtime | Python 3.13, ARM64, 256 MB |
| Entry points | `handlers.ingest.handler`, `handlers.processor.handler`, `handlers.query.handler` — keep these function names and file paths |
| Timeouts | ingest 10 s, processor 30 s, query 10 s |
| Max instances | 2 per function (cost cap) |
| Dependencies | Only the standard library and `boto3` (already in the Lambda runtime). `requirements.txt` is **not** installed at deploy time — ask before adding a pip package. |
| Logs | `print` / `logging` go to CloudWatch log group `/aws/lambda/<function-name>`, kept 1 week |

### Environment variables

| Variable | Available in | Meaning |
|---|---|---|
| `QUEUE_URL` | ingest | SQS FIFO queue URL |
| `SNAPSHOTS_TABLE` | processor, query | History table name |
| `LATEST_TABLE` | processor, query | Latest-per-device table name |
| `ALLOWED_ORIGIN` | ingest, query | CORS origin of the dashboard (set in a later infra step; defaults to `*`) |

The contracts guide mentions `DB_CONNECTION_STRING` and `INGESTION_API_KEY` — those are from
the Azure version and **do not exist here**. Use the table names above, and don't check the
API key in Python: API Gateway (being added in the next infra step) rejects requests with a
missing or wrong `x-api-key` with `401` before the Lambda runs.

### Permissions

| Lambda | Can do |
|---|---|
| ingest | `sqs:SendMessage` on the events queue |
| processor | read + write both tables (consumes the queue automatically) |
| query | read both tables |

Anything else (another table, S3, …) needs an infra change.

## 3. ingest.py — `POST /api/telemetry` (Contract A)

**Input:** API Gateway REST proxy event. The request body is the string `event["body"]`;
headers are in `event["headers"]`.

**Must return** a proxy response: `{"statusCode": int, "headers": {...}, "body": "<json string>"}`.
Keep the `Access-Control-Allow-Origin` header (use the existing `_response` helper).

**To do:**
1. Full validation per Track 2, step 2 — every event needs `deviceId`, `eventType`, `value`,
   `unit`, ISO UTC `timestamp` ending in `Z`, and:
   - `battery_level`: number, `0.0 <= value <= 1.0`, unit `ratio`
   - `charging_state`: boolean, unit `boolean`
   - `acceleration`: object with finite numbers `x`, `y`, `z`, unit `m/s2`
2. On any invalid event return `400 {"error": "Validation failed", "details": "<reason>"}` and
   send nothing to the queue.
3. Keep the queue-sending part as it is:
   - one SQS message **per device**, body = JSON array of that device's raw events
   - `MessageGroupId = deviceId` (this is what keeps each device's events in order)
   - don't set `MessageDeduplicationId` — the queue de-duplicates identical bodies sent
     within 5 minutes (phone retries)
4. Return `202 {"accepted": <event count>, "deviceId": "<deviceId>"}`.

Do **not** compute anything here — all calculations happen in the processor.

## 4. processor.py — SQS → DynamoDB (Contract B)

**Input:** SQS batch event, up to 10 records:

```json
{ "Records": [ { "messageId": "…", "body": "[{\"deviceId\":\"fleet-phone-01\",\"eventType\":\"battery_level\",…}, …]" } ] }
```

Each record's `body` is a JSON array of raw Contract A events for **one** device (what
ingest.py sent). Records of the same device arrive in the order they were sent.

**To do — implement `process_events(raw_events)`:**
1. Read the previous snapshot of the device from `LATEST_TABLE` (`get_item` by `deviceId`).
   If none, use the defaults from Track 2 step 3.
2. If the events contain several timestamps, process them oldest first, one snapshot per
   timestamp.
3. Apply Track 2 steps 1–3: battery %, charging flag, acceleration magnitude → `activityState`,
   drain rate, `estimatedMinutesRemaining`, alert state machine.
4. Write the snapshot (Contract B fields) to **both** tables:
   - `SNAPSHOTS_TABLE`: `put_item` — key `deviceId` + `timestamp`
   - `LATEST_TABLE`: `put_item` — key `deviceId`
5. Raise an exception if anything goes wrong — don't swallow it (see retries below).

**Item shape (both tables):**

```json
{
  "id": "fleet-phone-01_2026-11-20T18:30:00Z",
  "deviceId": "fleet-phone-01",
  "timestamp": "2026-11-20T18:30:00Z",
  "batteryLevel": 78.5,
  "isCharging": false,
  "activityState": "in_vehicle",
  "drainRatePerHour": 9.4,
  "estimatedMinutesRemaining": 501,
  "alertStatus": "OK",
  "alertReason": null,
  "expiresAt": 1764268200
}
```

- `timestamp` is the sort key: keep the exact format `YYYY-MM-DDTHH:MM:SSZ` (UTC, `Z`, same
  precision everywhere) so sorting by string = sorting by time.
- `expiresAt` (optional, history table only): epoch **seconds**; DynamoDB deletes the item
  after that time. E.g. now + 7 days. Leave it out to keep history forever.
- **Floats:** boto3 rejects Python `float` for DynamoDB. Convert numbers with
  `Decimal(str(value))` before writing.

**Retries and the DLQ (already implemented in `handler`, don't remove):**
- If `process_events` raises, that message **and every later message in the batch** are
  reported as failed, so SQS retries them in order.
- After 3 failed attempts a message moves to the dead-letter queue
  `fleet-telemetry-events-dlq.fifo` and the alarm `fleet-telemetry-events-dlq-not-empty` fires.
- A message can be processed more than once (retry after a timeout). Writes must be safe to
  repeat — `put_item` with the same keys simply overwrites, which is fine.

## 5. query.py — dashboard API (Contract C)

**Input:** API Gateway REST proxy event. `event["pathParameters"]["deviceId"]` is set for the
telemetry route; `event["queryStringParameters"]` may be `None`.

**To do:**
1. `GET /api/devices`: map each `LATEST_TABLE` item to Contract C: rename `timestamp` →
   `lastUpdated`, drop `id` / `expiresAt`.
2. `GET /api/devices/{deviceId}/telemetry?limit=50`: return
   `{"deviceId": …, "records": [...]}`, records newest first (the query already uses
   `ScanIndexForward=False`), without `deviceId` / `id` / `expiresAt` inside each record.
3. Keep `_json_default` — DynamoDB returns numbers as `Decimal`.

## 6. Running and testing

**Locally** (Python 3.13):

```bash
python -m venv .venv
.venv/Scripts/activate        # Windows; use .venv/bin/activate on macOS/Linux
pip install -r requirements-dev.txt
```

Put the pure logic (validation, calculations, alert rules) in functions that don't touch AWS,
so you can unit-test them without credentials. Tests go in `src/backend/tests/` (excluded from
the deployed package).

**In AWS** (after the infra owner deploys, from `infrastructure/`):

```bash
npx cdk deploy
```

Deploying uploads the current contents of `src/backend`, so redeploy after every code change.
To test the processor without the phone, send a message to the queue:

```bash
aws sqs send-message --queue-url <EventsQueueUrl output> --message-group-id fleet-phone-01 --message-body '[{"deviceId":"fleet-phone-01","eventType":"battery_level","value":0.785,"unit":"ratio","timestamp":"2026-11-20T18:30:00Z"}]'
```

Then check the logs:

```bash
aws logs tail /aws/lambda/fleet-telemetry-processor --follow
```

## 7. Checklist before handing back

- [ ] Entry points and file names unchanged
- [ ] No new pip dependencies (or agreed with infra)
- [ ] ingest returns 400 for every invalid case in Track 2 and sends nothing to SQS then
- [ ] processor writes both tables, uses `Decimal`, raises on failure
- [ ] query responses match Contract C exactly
- [ ] Timestamps stay `YYYY-MM-DDTHH:MM:SSZ`
