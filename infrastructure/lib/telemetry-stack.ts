import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';

export interface TelemetryStackProps extends cdk.StackProps {
  /** Prefix used when naming resources, e.g. "fleet-telemetry". */
  readonly projectName: string;
}

/**
 * Serverless telemetry platform:
 * API Gateway -> ingest Lambda -> SQS FIFO (+ DLQ) -> processor Lambda -> DynamoDB,
 * plus a query Lambda behind API Gateway for the web dashboard.
 *
 * Resources are added in follow-up parts.
 */
export class TelemetryStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: TelemetryStackProps) {
    super(scope, id, props);
  }
}
