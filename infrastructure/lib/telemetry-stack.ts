import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { TelemetryApi } from './constructs/telemetry-api';
import { PROCESSOR_TIMEOUT, TelemetryFunctions } from './constructs/telemetry-functions';
import { TelemetryQueue } from './constructs/telemetry-queue';
import { TelemetryTables } from './constructs/telemetry-tables';
import { WebHosting } from './constructs/web-hosting';

export interface TelemetryStackProps extends cdk.StackProps {
  /** Prefix used when naming resources, e.g. "fleet-telemetry". */
  readonly projectName: string;
  /**
   * Max instances per Lambda function (reserved concurrency). 0 disables reservation.
   * @default 2
   */
  readonly lambdaReservedConcurrency?: number;
  /**
   * Browser origin allowed by CORS. Override for local development,
   * e.g. "http://localhost:5173" or "*".
   * The mobile app is a native APK and doesn't need CORS.
   * @default - the CloudFront URL that hosts the web dashboard
   */
  readonly allowedOrigin?: string;
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
  public readonly api: TelemetryApi;
  public readonly web: WebHosting;

  constructor(scope: Construct, id: string, props: TelemetryStackProps) {
    super(scope, id, props);

    this.web = new WebHosting(this, 'Web', {
      projectName: props.projectName,
    });

    const allowedOrigin = props.allowedOrigin ?? this.web.origin;

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
      allowedOrigin,
    });

    this.api = new TelemetryApi(this, 'Api', {
      projectName: props.projectName,
      functions: this.functions,
      allowedOrigin,
    });

    new cdk.CfnOutput(this, 'DashboardUrl', {
      value: `${this.web.origin}/dashboard/`,
      description: 'Web dashboard',
    });
    new cdk.CfnOutput(this, 'SiteBucketName', {
      value: this.web.bucket.bucketName,
      description: 'The dashboard build is uploaded to s3://<bucket>/dashboard/',
    });
    new cdk.CfnOutput(this, 'DistributionId', {
      value: this.web.distribution.distributionId,
      description: 'CloudFront distribution id (for cache invalidation after uploads)',
    });
    new cdk.CfnOutput(this, 'AllowedOrigin', {
      value: allowedOrigin,
      description: 'CORS origin the API accepts',
    });
    new cdk.CfnOutput(this, 'ApiBaseUrl', {
      value: this.api.baseUrl,
      description: 'Base URL for the dashboard and the mobile app; routes start with /api/...',
    });
    new cdk.CfnOutput(this, 'IngestionApiKeyId', {
      value: this.api.ingestionApiKey.keyId,
      description: 'Id of the x-api-key for POST /api/telemetry (see GetIngestionApiKeyCommand)',
    });
    new cdk.CfnOutput(this, 'GetIngestionApiKeyCommand', {
      value: cdk.Fn.join('', [
        'aws apigateway get-api-key --region ', this.region,
        ' --api-key ', this.api.ingestionApiKey.keyId,
        ' --include-value --query value --output text',
      ]),
      description: 'Prints the API key value (VITE_INGESTION_API_KEY)',
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
