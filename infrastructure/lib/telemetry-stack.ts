import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { PROCESSOR_TIMEOUT, TelemetryFunctions } from './constructs/telemetry-functions';
import { TelemetryQueue } from './constructs/telemetry-queue';
import { TelemetryTables } from './constructs/telemetry-tables';

export interface TelemetryStackProps extends cdk.StackProps {
  /** Prefix used when naming resources, e.g. "fleet-telemetry". */
  readonly projectName: string;
  /**
   * Max instances per Lambda function (reserved concurrency). 0 disables reservation.
   * @default 2
   */
  readonly lambdaReservedConcurrency?: number;
}

/**
 * Serverless telemetry platform:
 * API Gateway -> ingest Lambda -> SQS FIFO (+ DLQ) -> processor Lambda -> DynamoDB,
 * plus a query Lambda behind API Gateway for the web dashboard.
 */
export class TelemetryStack extends cdk.Stack {
  public readonly tables: TelemetryTables;
  public readonly events: TelemetryQueue;
  public readonly functions: TelemetryFunctions;

  constructor(scope: Construct, id: string, props: TelemetryStackProps) {
    super(scope, id, props);

    this.tables = new TelemetryTables(this, 'Tables', {
      projectName: props.projectName,
    });

    this.events = new TelemetryQueue(this, 'Events', {
      projectName: props.projectName,
      processorTimeout: PROCESSOR_TIMEOUT,
    });

    this.functions = new TelemetryFunctions(this, 'Functions', {
      projectName: props.projectName,
      tables: this.tables,
      events: this.events,
      reservedConcurrency: props.lambdaReservedConcurrency,
    });

    new cdk.CfnOutput(this, 'SnapshotsTableName', {
      value: this.tables.snapshotsTable.tableName,
      description: 'DynamoDB table with the full snapshot history per device',
    });
    new cdk.CfnOutput(this, 'LatestTableName', {
      value: this.tables.latestTable.tableName,
      description: 'DynamoDB table with the latest snapshot per device',
    });
    new cdk.CfnOutput(this, 'EventsQueueUrl', {
      value: this.events.queue.queueUrl,
      description: 'SQS FIFO queue between ingestion and processing',
    });
    new cdk.CfnOutput(this, 'EventsDeadLetterQueueUrl', {
      value: this.events.deadLetterQueue.queueUrl,
      description: 'SQS FIFO dead-letter queue for events that failed processing',
    });
  }
}
