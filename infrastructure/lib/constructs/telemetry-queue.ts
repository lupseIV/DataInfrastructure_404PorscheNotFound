import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';
import { queueNames } from '../naming';

export interface TelemetryQueueProps {
  /** Prefix used for queue names, e.g. "fleet-telemetry". */
  readonly projectName: string;
  /**
   * Timeout of the processor Lambda that consumes the queue.
   * The visibility timeout is set to 6x this value, as AWS recommends for Lambda consumers.
   * @default 30 seconds
   */
  readonly processorTimeout?: cdk.Duration;
  /**
   * How many times a message is attempted before it moves to the DLQ.
   * @default 3
   */
  readonly maxReceiveCount?: number;
}

/**
 * Buffer between ingestion and processing.
 *
 * FIFO so that events of the same device are processed in order: the ingest Lambda sends
 * with `MessageGroupId = deviceId`, so the drain-rate calculation always sees the previous
 * snapshot of that device. Different devices are still processed in parallel.
 *
 * Content-based deduplication drops identical batches re-sent within 5 minutes
 * (e.g. the phone retrying after a network timeout).
 *
 * Messages that fail `maxReceiveCount` times go to the DLQ, and an alarm fires
 * as soon as the DLQ is not empty.
 */
export class TelemetryQueue extends Construct {
  public readonly queue: sqs.Queue;
  public readonly deadLetterQueue: sqs.Queue;
  public readonly deadLetterAlarm: cloudwatch.Alarm;

  constructor(scope: Construct, id: string, props: TelemetryQueueProps) {
    super(scope, id);

    const names = queueNames(props.projectName);
    const processorTimeout = props.processorTimeout ?? cdk.Duration.seconds(30);

    this.deadLetterQueue = new sqs.Queue(this, 'DeadLetterQueue', {
      // FIFO queues require a FIFO DLQ; names must end in ".fifo".
      queueName: names.deadLetter,
      fifo: true,
      retentionPeriod: cdk.Duration.days(14),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.queue = new sqs.Queue(this, 'EventsQueue', {
      queueName: names.events,
      fifo: true,
      contentBasedDeduplication: true,
      visibilityTimeout: cdk.Duration.seconds(processorTimeout.toSeconds() * 6),
      retentionPeriod: cdk.Duration.days(4),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      enforceSSL: true,
      deadLetterQueue: {
        queue: this.deadLetterQueue,
        maxReceiveCount: props.maxReceiveCount ?? 3,
      },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.deadLetterAlarm = new cloudwatch.Alarm(this, 'DeadLetterAlarm', {
      alarmName: `${props.projectName}-events-dlq-not-empty`,
      alarmDescription: 'Telemetry events failed processing and landed in the DLQ',
      metric: this.deadLetterQueue.metricApproximateNumberOfMessagesVisible({
        period: cdk.Duration.minutes(5),
        statistic: cloudwatch.Stats.MAXIMUM,
      }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
  }
}
