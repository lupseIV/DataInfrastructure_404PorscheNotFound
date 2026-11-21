import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';
import { TelemetryFunctions } from '../constructs/telemetry-functions';
import { FUNCTION_NAMES, functionName, queueNames, tableNames } from '../naming';
import { CorsStackProps, resolveAllowedOrigin } from './shared';

export interface LambdaStackProps extends CorsStackProps {
  /**
   * Max instances per Lambda function (reserved concurrency). 0 disables reservation.
   * @default 2
   */
  readonly lambdaReservedConcurrency?: number;
}

/**
 * The Python Lambdas (code from src/backend), their log groups and the SQS trigger.
 *
 * Tables and queue come from the data stack and are looked up by name. Deploy the data
 * stack (and the web stack, for the CORS origin) before this one the first time.
 */
export class LambdaStack extends cdk.Stack {
  public readonly functions: TelemetryFunctions;

  constructor(scope: Construct, id: string, props: LambdaStackProps) {
    super(scope, id, props);

    const tables = tableNames(props.projectName);
    const queues = queueNames(props.projectName);

    this.functions = new TelemetryFunctions(this, 'Functions', {
      projectName: props.projectName,
      tables: {
        snapshotsTable: dynamodb.TableV2.fromTableName(this, 'SnapshotsTable', tables.snapshots),
        latestTable: dynamodb.TableV2.fromTableName(this, 'LatestTable', tables.latest),
        alertsTable: dynamodb.TableV2.fromTableName(this, 'AlertsTable', tables.alerts),
      },
      events: {
        queue: sqs.Queue.fromQueueAttributes(this, 'EventsQueue', {
          queueName: queues.events,
          queueArn: this.formatArn({ service: 'sqs', resource: queues.events }),
          fifo: true,
        }),
      },
      reservedConcurrency: props.lambdaReservedConcurrency,
      allowedOrigin: resolveAllowedOrigin(this, props.projectName, props.allowedOrigin),
    });

    new cdk.CfnOutput(this, 'FunctionNames', {
      value: FUNCTION_NAMES.map((name) => functionName(props.projectName, name)).join(' '),
      description: 'Lambda functions in this stack (code updates: aws lambda update-function-code)',
    });
  }
}
