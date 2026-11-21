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
 * Thresholds of the event Lambdas (Contracts D1 to E2), passed as environment variables.
 * The values match the defaults in src/backend/handlers/event_validation.py.
 */
const BATTERY_THRESHOLDS: Record<string, string> = {
  BATTERY_LOW_THRESHOLD: '0.20',
  BATTERY_LAST_CALL_THRESHOLD: '0.10',
};
const CONNECTIVITY_THRESHOLDS: Record<string, string> = {
  SIGNAL_DROP_BARS: '2',
  SIGNAL_DROP_WINDOW_SECONDS: '60',
  SIGNAL_LOST_DBM: '-110',
};

/**
 * The Python Lambdas of the backend. Code lives in src/backend/handlers.
 *
 * - ingest:    POST /api/telemetry -> SQS FIFO queue
 * - processor: SQS FIFO queue -> DynamoDB snapshots
 * - query:     GET /api/devices and GET /api/devices/{deviceId}/telemetry
 *
 * Event Lambdas (Contracts D1 to E2): one function per family, each serving two routes and
 * choosing the event from the request path. Both write to the alerts and latest tables.
 * - battery:       POST /api/events/battery-low and /api/events/battery-last-call
 * - connectivity:  POST /api/events/connectivity-degraded and /api/events/connectivity-last-call
 */
export class TelemetryFunctions extends Construct {
  public readonly ingestFunction: lambda.Function;
  public readonly processorFunction: lambda.Function;
  public readonly queryFunction: lambda.Function;
  public readonly batteryFunction: lambda.Function;
  public readonly connectivityFunction: lambda.Function;

  constructor(scope: Construct, id: string, props: TelemetryFunctionsProps) {
    super(scope, id);

    const reserved = props.reservedConcurrency ?? 2;
    const backendCode = lambda.Code.fromAsset(path.join(__dirname, '..', '..', '..', 'src', 'backend'), {
      exclude: ['__pycache__', '*.pyc', '.venv', '.idea', 'tests', 'README.md', 'requirements-dev.txt', '.gitignore'],
    });

    const createFunction = (name: string, handler: string, timeout: cdk.Duration, environment: Record<string, string>) => {
      const functionName = `${props.projectName}-${name}`;
      // "battery-last-call" -> "BatteryLastCallFunction"; single-word names give the same ids as before.
      const pascal = name.split('-').map((part) => part[0].toUpperCase() + part.slice(1)).join('');
      return new lambda.Function(this, `${pascal}Function`, {
        functionName,
        runtime: lambda.Runtime.PYTHON_3_13,
        architecture: lambda.Architecture.ARM_64,
        code: backendCode,
        handler,
        memorySize: 256,
        timeout,
        environment,
        reservedConcurrentExecutions: reserved > 0 ? reserved : undefined,
        // Keep the original id scheme: renaming the log group ids of the existing functions
        // would make CloudFormation replace log groups that have fixed names.
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

    // Event Lambdas (Contracts D1 to E2): each writes an alert row and updates the device's
    // latest item, so they only need write access to the two tables.
    const createEventFunction = (name: string, handler: string, thresholds: Record<string, string>) => {
      const fn = createFunction(name, handler, cdk.Duration.seconds(10), {
        ALERTS_TABLE: props.tables.alertsTable.tableName,
        LATEST_TABLE: props.tables.latestTable.tableName,
        ALLOWED_ORIGIN: props.allowedOrigin,
        ...thresholds,
      });
      props.tables.alertsTable.grantWriteData(fn);
      props.tables.latestTable.grantWriteData(fn);
      return fn;
    };

    this.batteryFunction = createEventFunction('battery', 'handlers.battery.handler', BATTERY_THRESHOLDS);
    this.connectivityFunction = createEventFunction(
      'connectivity',
      'handlers.connectivity.handler',
      CONNECTIVITY_THRESHOLDS,
    );
  }
}
