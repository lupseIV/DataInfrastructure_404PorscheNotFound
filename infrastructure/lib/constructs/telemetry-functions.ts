import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';
import { FunctionName, functionName as fullFunctionName } from '../naming';

/** Timeout of the processor Lambda; the queue's visibility timeout is derived from it. */
export const PROCESSOR_TIMEOUT = cdk.Duration.seconds(30);

/** The DynamoDB tables the functions use (created by the data stack, looked up by name). */
export interface TelemetryTableRefs {
  readonly snapshotsTable: dynamodb.ITableV2;
  readonly latestTable: dynamodb.ITableV2;
  readonly alertsTable: dynamodb.ITableV2;
}

/** The SQS queue between ingest and processor (created by the data stack, looked up by name). */
export interface TelemetryQueueRefs {
  readonly queue: sqs.IQueue;
}

export interface TelemetryFunctionsProps {
  /** Prefix used for function names, e.g. "fleet-telemetry". */
  readonly projectName: string;
  readonly tables: TelemetryTableRefs;
  readonly events: TelemetryQueueRefs;
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
 * The values match the defaults in src/backend/functions/battery/validation.py and connectivity/validation.py.
 */
const BATTERY_THRESHOLDS: Record<string, string> = {
  BATTERY_LOW_THRESHOLD: '0.20',
  BATTERY_LAST_CALL_THRESHOLD: '0.10',
};
const CONNECTIVITY_THRESHOLDS: Record<string, string> = {
  SIGNAL_DROP_BARS: '2',
  SIGNAL_DROP_DBM: '15',
  SIGNAL_DROP_WINDOW_SECONDS: '60',
  SIGNAL_LOST_DBM: '-110',
};
/** Contract F timers; the values match the defaults in src/backend/functions/presence/rules.py. */
const PRESENCE_SETTINGS: Record<string, string> = {
  SUSPECT_AFTER_SECONDS: '60',
  OFFLINE_GRACE_SECONDS: '240',
};
/** Contract C #4 path selection; the values match the defaults in src/backend/functions/query/path.py. */
const PATH_SETTINGS: Record<string, string> = {
  PATH_MAX_ACCURACY_M: '100',
  PATH_GAP_SECONDS: '60',
};

/**
 * The Python Lambdas of the backend. Code lives in src/backend:
 *   functions/<name>/handler.py  entry point of each function (handler "functions.<name>.handler.handler")
 * There is no shared package: each function folder bundles every module it needs (helper
 * modules are copied, see src/backend/tests/test_copies.py). Each function is packaged with only
 * its own folder, so changing one folder changes only that function's code and CloudFormation diff.
 *
 * - ingest:    POST /api/telemetry -> SQS FIFO queue
 * - processor: SQS FIFO queue -> DynamoDB snapshots
 * - query:     GET /api/devices, /api/devices/{deviceId}/telemetry, /alerts and /path
 * - presence:  EventBridge every minute -> marks silent devices SUSPECT / OFFLINE (Contract F)
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
  public readonly presenceFunction: lambda.Function;

  constructor(scope: Construct, id: string, props: TelemetryFunctionsProps) {
    super(scope, id);

    const reserved = props.reservedConcurrency ?? 2;
    const backendDir = path.join(__dirname, '..', '..', '..', 'src', 'backend');
    // Package layout (same as the Lambda code jobs in .github/workflows/infra-deploy-lambda.yml):
    //   functions/__init__.py, functions/<name>/
    const codeFor = (name: FunctionName) =>
      lambda.Code.fromAsset(backendDir, {
        exclude: [
          // nothing outside functions/
          'tests', 'requirements*.txt', 'README.md', '.gitignore', '.pytest_cache', '.venv', '.idea',
          // only this function's folder
          'functions/*', '!functions/__init__.py', `!functions/${name}`,
          '__pycache__', '*.pyc',
        ],
      });

    const createFunction = (name: FunctionName, timeout: cdk.Duration, environment: Record<string, string>) => {
      const functionName = fullFunctionName(props.projectName, name);
      // "battery-last-call" -> "BatteryLastCallFunction"; single-word names give the same ids as before.
      const pascal = name.split('-').map((part) => part[0].toUpperCase() + part.slice(1)).join('');
      return new lambda.Function(this, `${pascal}Function`, {
        functionName,
        runtime: lambda.Runtime.PYTHON_3_13,
        architecture: lambda.Architecture.ARM_64,
        code: codeFor(name),
        handler: `functions.${name}.handler.handler`,
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

    this.ingestFunction = createFunction('ingest', cdk.Duration.seconds(10), {
      QUEUE_URL: props.events.queue.queueUrl,
      ALLOWED_ORIGIN: props.allowedOrigin,
    });
    props.events.queue.grantSendMessages(this.ingestFunction);

    this.processorFunction = createFunction('processor', PROCESSOR_TIMEOUT, tableEnv);
    props.tables.snapshotsTable.grantReadWriteData(this.processorFunction);
    props.tables.latestTable.grantReadWriteData(this.processorFunction);
    this.processorFunction.addEventSource(
      new SqsEventSource(props.events.queue, {
        batchSize: 10,
        maxConcurrency: props.processorMaxConcurrency ?? 2,
        reportBatchItemFailures: true,
      }),
    );

    this.queryFunction = createFunction('query', cdk.Duration.seconds(10), {
      ...tableEnv,
      ALERTS_TABLE: props.tables.alertsTable.tableName,
      ALLOWED_ORIGIN: props.allowedOrigin,
      ...PATH_SETTINGS,
    });
    props.tables.snapshotsTable.grantReadData(this.queryFunction); // also GET .../path
    props.tables.latestTable.grantReadData(this.queryFunction);
    props.tables.alertsTable.grantReadData(this.queryFunction); // GET .../alerts

    // Event Lambdas (Contracts D1 to E2): each writes an alert row and updates the device's
    // latest item, so they only need write access to the two tables.
    const createEventFunction = (name: FunctionName, thresholds: Record<string, string>) => {
      const fn = createFunction(name, cdk.Duration.seconds(10), {
        ALERTS_TABLE: props.tables.alertsTable.tableName,
        LATEST_TABLE: props.tables.latestTable.tableName,
        ALLOWED_ORIGIN: props.allowedOrigin,
        ...thresholds,
      });
      props.tables.alertsTable.grantWriteData(fn);
      props.tables.latestTable.grantWriteData(fn);
      return fn;
    };

    this.batteryFunction = createEventFunction('battery', BATTERY_THRESHOLDS);
    this.connectivityFunction = createEventFunction('connectivity', CONNECTIVITY_THRESHOLDS);

    // Presence (Contract F): scans the latest table every minute and writes presenceState
    // plus presence_offline / presence_recovered rows. Its writes are conditional, so two
    // overlapping runs are harmless and no reserved concurrency is needed.
    this.presenceFunction = createFunction('presence', cdk.Duration.seconds(30), {
      LATEST_TABLE: props.tables.latestTable.tableName,
      ALERTS_TABLE: props.tables.alertsTable.tableName,
      ...PRESENCE_SETTINGS,
    });
    props.tables.latestTable.grantReadWriteData(this.presenceFunction); // Scan + conditional UpdateItem
    props.tables.alertsTable.grantWriteData(this.presenceFunction); // PutItem (inside the transaction)
    // Never retry a failed sweep: the next one starts a minute later anyway.
    this.presenceFunction.configureAsyncInvoke({ retryAttempts: 0, maxEventAge: cdk.Duration.minutes(1) });

    new events.Rule(this, 'PresenceSchedule', {
      description: 'Runs the presence sweep that marks silent devices SUSPECT / OFFLINE',
      schedule: events.Schedule.rate(cdk.Duration.minutes(1)),
      targets: [new targets.LambdaFunction(this.presenceFunction, { retryAttempts: 0 })],
    });
  }
}
