#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { TelemetryStack } from '../lib/telemetry-stack';

const app = new cdk.App();

const projectName: string = app.node.tryGetContext('projectName') ?? 'fleet-telemetry';
const region: string = app.node.tryGetContext('region') ?? 'eu-central-1';
const lambdaReservedConcurrency = Number(app.node.tryGetContext('lambdaReservedConcurrency') ?? 2);

new TelemetryStack(app, 'TelemetryStack', {
  stackName: `${projectName}-stack`,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region,
  },
  projectName,
  lambdaReservedConcurrency,
});

cdk.Tags.of(app).add('project', projectName);
cdk.Tags.of(app).add('managed-by', 'cdk');
