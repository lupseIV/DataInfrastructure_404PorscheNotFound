#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { GithubDeployRoleStack } from '../lib/github-deploy-role-stack';
import { TelemetryStack } from '../lib/telemetry-stack';

const app = new cdk.App();

const projectName: string = app.node.tryGetContext('projectName') ?? 'fleet-telemetry';
const region: string = app.node.tryGetContext('region') ?? 'eu-central-1';
const lambdaReservedConcurrency = Number(app.node.tryGetContext('lambdaReservedConcurrency') ?? 2);
// Unset = the CloudFront URL of the web apps. Override with -c allowedOrigin=http://localhost:5173
const allowedOrigin: string | undefined = app.node.tryGetContext('allowedOrigin');

new TelemetryStack(app, 'TelemetryStack', {
  stackName: `${projectName}-stack`,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region,
  },
  projectName,
  lambdaReservedConcurrency,
  allowedOrigin,
});

// One-time setup (deployed manually): IAM role that GitHub Actions uses to run `cdk deploy`.
new GithubDeployRoleStack(app, 'GithubDeployRoleStack', {
  stackName: `${projectName}-github-deploy`,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region,
  },
  projectName,
  githubRepo: app.node.tryGetContext('githubRepo'),
  existingOidcProviderArn: app.node.tryGetContext('githubOidcProviderArn'),
});

cdk.Tags.of(app).add('project', projectName);
cdk.Tags.of(app).add('managed-by', 'cdk');
