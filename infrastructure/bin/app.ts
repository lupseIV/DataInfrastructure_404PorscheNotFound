#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { GithubDeployRoleStack } from '../lib/github-deploy-role-stack';
import { stackNames } from '../lib/naming';
import { ApiStack } from '../lib/stacks/api-stack';
import { DataStack } from '../lib/stacks/data-stack';
import { LambdaStack } from '../lib/stacks/lambda-stack';
import { WebStack } from '../lib/stacks/web-stack';

const app = new cdk.App();

const projectName: string = app.node.tryGetContext('projectName') ?? 'fleet-telemetry';
const region: string = app.node.tryGetContext('region') ?? 'eu-west-1';
const lambdaReservedConcurrency = Number(app.node.tryGetContext('lambdaReservedConcurrency') ?? 2);
// Unset = the CloudFront URL of the web apps. Override with -c allowedOrigin=http://localhost:5173
const allowedOrigin: string | undefined = app.node.tryGetContext('allowedOrigin');

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region,
};
const names = stackNames(projectName);

// Four independent stacks. They find each other's resources by fixed names (lib/naming.ts)
// and an SSM parameter, never through CloudFormation exports, so each can be deployed alone.
//
//   WebStack ──(SSM: web origin)──┐
//   DataStack ──(table/queue names)──▶ LambdaStack ──(function names)──▶ ApiStack
//
// addStackDependency only sets the order when several stacks are deployed together
// (and the first deploy); `cdk deploy --exclusively <stack>` deploys just one.
const webStack = new WebStack(app, 'WebStack', {
  stackName: names.web,
  description: 'Fleet telemetry: web dashboard hosting (S3 + CloudFront)',
  env,
  projectName,
});

const dataStack = new DataStack(app, 'DataStack', {
  stackName: names.data,
  description: 'Fleet telemetry: DynamoDB tables and SQS FIFO queue',
  env,
  projectName,
});

const lambdaStack = new LambdaStack(app, 'LambdaStack', {
  stackName: names.lambdas,
  description: 'Fleet telemetry: Python Lambda functions',
  env,
  projectName,
  lambdaReservedConcurrency,
  allowedOrigin,
});
lambdaStack.addStackDependency(dataStack, 'Uses the tables and the queue');
lambdaStack.addStackDependency(webStack, 'Reads the web origin from SSM for CORS');

const apiStack = new ApiStack(app, 'ApiStack', {
  stackName: names.api,
  description: 'Fleet telemetry: REST API (API Gateway) and ingestion API key',
  env,
  projectName,
  allowedOrigin,
});
apiStack.addStackDependency(lambdaStack, 'Routes invoke the Lambda functions');
apiStack.addStackDependency(webStack, 'Reads the web origin from SSM for CORS');

// One-time setup (deployed manually): IAM role that GitHub Actions uses to run `cdk deploy`.
new GithubDeployRoleStack(app, 'GithubDeployRoleStack', {
  stackName: names.githubDeployRole,
  env,
  projectName,
  githubRepo: app.node.tryGetContext('githubRepo'),
  githubImmutableSubjectPrefix: app.node.tryGetContext('githubImmutableSubjectPrefix'),
  existingOidcProviderArn: app.node.tryGetContext('githubOidcProviderArn'),
});

cdk.Tags.of(app).add('project', projectName);
cdk.Tags.of(app).add('managed-by', 'cdk');
