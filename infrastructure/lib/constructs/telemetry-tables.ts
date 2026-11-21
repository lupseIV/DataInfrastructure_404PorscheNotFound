import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';
import { tableNames } from '../naming';

export interface TelemetryTablesProps {
  /** Prefix used for table names, e.g. "fleet-telemetry". */
  readonly projectName: string;
  /**
   * Upper bound on read/write request units per second for each table.
   * On-demand tables throttle above this, which caps the worst-case bill.
   * @default 100
   */
  readonly maxRequestUnitsPerSecond?: number;
}

/**
 * DynamoDB persistence for processed health snapshots (Contract B).
 *
 * - `snapshotsTable`: full history. PK `deviceId`, SK `timestamp` (ISO-8601 UTC string,
 *   sorts chronologically). Serves `GET /api/devices/{deviceId}/telemetry?limit=N`
 *   with a single Query (ScanIndexForward=false, Limit=N).
 *   Items may set `expiresAt` (epoch seconds) to be removed automatically by TTL.
 * - `latestTable`: one item per device holding its newest snapshot. Serves
 *   `GET /api/devices` and gives the processor the "previous snapshot" for drain-rate
 *   calculations without scanning history.
 * - `alertsTable`: last-call, status and presence events (battery-low, battery-last-call,
 *   connectivity-degraded, connectivity-last-call, presence_offline, presence_recovered).
 *   PK `deviceId`, SK `sortKey` = `<timestamp>#<alertType>`, so different alert types with
 *   the same timestamp never overwrite each other and a replayed event overwrites itself
 *   (idempotent). Items may set `expiresAt` (epoch seconds) for TTL removal.
 */
export class TelemetryTables extends Construct {
  public readonly snapshotsTable: dynamodb.TableV2;
  public readonly latestTable: dynamodb.TableV2;
  public readonly alertsTable: dynamodb.TableV2;

  constructor(scope: Construct, id: string, props: TelemetryTablesProps) {
    super(scope, id);

    const names = tableNames(props.projectName);
    const maxUnits = props.maxRequestUnitsPerSecond ?? 100;
    const billing = dynamodb.Billing.onDemand({
      maxReadRequestUnits: maxUnits,
      maxWriteRequestUnits: maxUnits,
    });

    this.snapshotsTable = new dynamodb.TableV2(this, 'SnapshotsTable', {
      tableName: names.snapshots,
      partitionKey: { name: 'deviceId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.STRING },
      billing,
      timeToLiveAttribute: 'expiresAt',
      // Hackathon environment: delete data with the stack to avoid leftover costs.
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.latestTable = new dynamodb.TableV2(this, 'LatestTable', {
      tableName: names.latest,
      partitionKey: { name: 'deviceId', type: dynamodb.AttributeType.STRING },
      billing,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.alertsTable = new dynamodb.TableV2(this, 'AlertsTable', {
      tableName: names.alerts,
      partitionKey: { name: 'deviceId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sortKey', type: dynamodb.AttributeType.STRING },
      billing,
      timeToLiveAttribute: 'expiresAt',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
  }
}
