import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { TelemetryTables } from './constructs/telemetry-tables';

export interface TelemetryStackProps extends cdk.StackProps {
  /** Prefix used when naming resources, e.g. "fleet-telemetry". */
  readonly projectName: string;
}

/**
 * Serverless telemetry platform:
 * API Gateway -> ingest Lambda -> SQS FIFO (+ DLQ) -> processor Lambda -> DynamoDB,
 * plus a query Lambda behind API Gateway for the web dashboard.
 */
export class TelemetryStack extends cdk.Stack {
  public readonly tables: TelemetryTables;

  constructor(scope: Construct, id: string, props: TelemetryStackProps) {
    super(scope, id, props);

    this.tables = new TelemetryTables(this, 'Tables', {
      projectName: props.projectName,
    });

    new cdk.CfnOutput(this, 'SnapshotsTableName', {
      value: this.tables.snapshotsTable.tableName,
      description: 'DynamoDB table with the full snapshot history per device',
    });
    new cdk.CfnOutput(this, 'LatestTableName', {
      value: this.tables.latestTable.tableName,
      description: 'DynamoDB table with the latest snapshot per device',
    });
  }
}
