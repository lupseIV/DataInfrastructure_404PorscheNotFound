import * as cdk from 'aws-cdk-lib';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { webOriginParameterName } from '../naming';

/** Props every application stack takes. */
export interface ProjectStackProps extends cdk.StackProps {
  /** Prefix used when naming resources, e.g. "fleet-telemetry". */
  readonly projectName: string;
}

/** Props of the stacks that serve the browser and need the CORS origin. */
export interface CorsStackProps extends ProjectStackProps {
  /**
   * Browser origin allowed by CORS. Override for local development,
   * e.g. "http://localhost:5173" or "*".
   * The mobile app is a native APK and doesn't need CORS.
   * @default - the dashboard's CloudFront origin, read from the SSM parameter the web stack writes
   */
  readonly allowedOrigin?: string;
}

/**
 * The CORS origin for the API and the HTTP-facing Lambdas.
 *
 * Without an override, the value is read from SSM when CloudFormation deploys the stack
 * (a dynamic parameter, not an export), so the web stack can change without blocking this one.
 * Redeploy this stack to pick up a new origin.
 */
export function resolveAllowedOrigin(scope: Construct, projectName: string, override?: string): string {
  return override ?? ssm.StringParameter.valueForStringParameter(scope, webOriginParameterName(projectName));
}
