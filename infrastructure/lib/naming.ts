/**
 * Fixed resource names shared by the stacks.
 *
 * The stacks never reference each other through CloudFormation exports. Each one finds the
 * resources it uses by these names (or through an SSM parameter), so any stack can be
 * deployed on its own without CloudFormation blocking the change.
 */

/** Lambda functions of the backend. The name is also the code folder: src/backend/functions/<name>/handler.py */
export const FUNCTION_NAMES = ['ingest', 'processor', 'query', 'battery', 'connectivity', 'presence'] as const;
export type FunctionName = (typeof FUNCTION_NAMES)[number];

/** CloudFormation stack names, e.g. "fleet-telemetry-web". */
export const stackNames = (projectName: string) => ({
  web: `${projectName}-web`,
  data: `${projectName}-data`,
  lambdas: `${projectName}-lambdas`,
  api: `${projectName}-api`,
  githubDeployRole: `${projectName}-github-deploy`,
});

export const tableNames = (projectName: string) => ({
  snapshots: `${projectName}-snapshots`,
  latest: `${projectName}-latest`,
  alerts: `${projectName}-alerts`,
});

export const queueNames = (projectName: string) => ({
  // FIFO queue names must end in ".fifo".
  events: `${projectName}-events.fifo`,
  deadLetter: `${projectName}-events-dlq.fifo`,
});

export const functionName = (projectName: string, name: FunctionName) => `${projectName}-${name}`;

/** Site bucket name; fixed so the GitHub deploy role can be scoped to it. */
export const siteBucketName = (projectName: string, account: string, region: string) =>
  `${projectName}-site-${account}-${region}`;

/**
 * SSM parameter holding the dashboard's origin (https://<cloudfront domain>).
 * Written by the web stack, read by the Lambda and API stacks for CORS.
 */
export const webOriginParameterName = (projectName: string) => `/${projectName}/web/origin`;
