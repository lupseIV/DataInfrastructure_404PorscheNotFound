import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import { TelemetryQueue } from './telemetry-queue';
import { TelemetryTables } from './telemetry-tables';

/** Timeout of the processor Lambda; the queue's visibility timeout is derived from it. */
export const PROCESSOR_TIMEOUT = cdk.Duration.seconds(30);

export interface TelemetryFunctionsProps {
  /** Prefix used for function names, e.g. "fleet-telemetry". */
  readonly projectName: string;
  readonly tables: TelemetryTables;
  readonly events: TelemetryQueue;
  /** Browser origin allowed by CORS; passed to the HTTP-facing Lambdas as ALLOWED_ORIGIN. */
  readonly allowedOrigin: string;
  /**
   * Reserved concurrency for each function: the maximum number of instances that can run
   * at the same time. Keeps costs bounded. Set to 0 to not reserve any (needed on new
   * AWS accounts whose total concurrency limit is 10, where reserving fails to deploy).
   * @default 2
   */
  readonly reservedConcurrency?: number;
  /**
   * Maximum number of processor instances the SQS trigger may invoke at once.
   * AWS's minimum is 2.
   * @default 2
   */
  readonly processorMaxConcurrency?: number;
}

/**
 * The three Python Lambdas of the backend. Code lives in src/backend/handlers.
 *
 * - ingest:    POST /api/telemetry -> SQS FIFO queue
 * - processor: SQS FIFO queue -> DynamoDB snapshots
 * - query:     GET /api/devices and GET /api/devices/{deviceId}/telemetry
 */
export class TelemetryFunctions extends Construct {
  public readonly ingestFunction: lambda.Function;
  public readonly processorFunction: lambda.Function;
  public readonly queryFunction: lambda.Function;

  constructor(scope: Construct, id: string, props: TelemetryFunctionsProps) {
    super(scope, id);

    const reserved = props.reservedConcurrency ?? 2;
    const backendCode = lambda.Code.fromAsset(path.join(__dirname, '..', '..', '..', 'src', 'backend'), {
      exclude: ['__pycache__', '*.pyc', '.venv', 'tests', 'requirements-dev.txt', '.gitignore'],
    });

    const createFunction = (name: string, handler: string, timeout: cdk.Duration, environment: Record<string, string>) => {
      const functionName = `${props.projectName}-${name}`;
      return new lambda.Function(this, `${name[0].toUpperCase()}${name.slice(1)}Function`, {
        functionName,
        runtime: lambda.Runtime.PYTHON_3_13,
        architecture: lambda.Architecture.ARM_64,
        code: backendCode,
        handler,
        memorySize: 256,
        timeout,
        environment,
        reservedConcurrentExecutions: reserved > 0 ? reserved : undefined,
        logGroup: new logs.LogGroup(this, `${name}Logs`, {
          logGroupName: `/aws/lambda/${functionName}`,
          retention: logs.RetentionDays.ONE_WEEK,
          removalPolicy: cdk.RemovalPolicy.DESTROY,
        }),
      });
    };

    const tableEnv = {
      SNAPSHOTS_TABLE: props.tables.snapshotsTable.tableName,
      LATEST_TABLE: props.tables.latestTable.tableName,
    };

    this.ingestFunction = createFunction('ingest', 'handlers.ingest.handler', cdk.Duration.seconds(10), {
      QUEUE_URL: props.events.queue.queueUrl,
      ALLOWED_ORIGIN: props.allowedOrigin,
    });
    props.events.queue.grantSendMessages(this.ingestFunction);

    this.processorFunction = createFunction('processor', 'handlers.processor.handler', PROCESSOR_TIMEOUT, tableEnv);
    props.tables.snapshotsTable.grantReadWriteData(this.processorFunction);
    props.tables.latestTable.grantReadWriteData(this.processorFunction);
    this.processorFunction.addEventSource(
      new SqsEventSource(props.events.queue, {
        batchSize: 10,
        maxConcurrency: props.processorMaxConcurrency ?? 2,
        reportBatchItemFailures: true,
      }),
    );

    this.queryFunction = createFunction('query', 'handlers.query.handler', cdk.Duration.seconds(10), {
      ...tableEnv,
      ALLOWED_ORIGIN: props.allowedOrigin,
    });
    props.tables.snapshotsTable.grantReadData(this.queryFunction);
    props.tables.latestTable.grantReadData(this.queryFunction);
  }
}
