import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { PROCESSOR_TIMEOUT } from '../constructs/telemetry-functions';
import { TelemetryQueue } from '../constructs/telemetry-queue';
import { TelemetryTables } from '../constructs/telemetry-tables';
import { ProjectStackProps } from './shared';

/**
 * Stateful resources: the DynamoDB tables and the SQS FIFO queue (+ DLQ and its alarm).
 *
 * The Lambda stack finds them by their fixed names (see naming.ts), so this stack changes
 * rarely and can be deployed without touching the functions.
 */
export class DataStack extends cdk.Stack {
  public readonly tables: TelemetryTables;
  public readonly events: TelemetryQueue;

  constructor(scope: Construct, id: string, props: ProjectStackProps) {
    super(scope, id, props);

    this.tables = new TelemetryTables(this, 'Tables', {
      projectName: props.projectName,
    });

    this.events = new TelemetryQueue(this, 'Events', {
      projectName: props.projectName,
      processorTimeout: PROCESSOR_TIMEOUT,
    });

    new cdk.CfnOutput(this, 'SnapshotsTableName', {
      value: this.tables.snapshotsTable.tableName,
      description: 'DynamoDB table with the full snapshot history per device',
    });
    new cdk.CfnOutput(this, 'LatestTableName', {
      value: this.tables.latestTable.tableName,
      description: 'DynamoDB table with the latest snapshot per device',
    });
    new cdk.CfnOutput(this, 'AlertsTableName', {
      value: this.tables.alertsTable.tableName,
      description: 'DynamoDB table with last-call, status and presence events per device',
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
