import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';
import { TelemetryApi } from '../constructs/telemetry-api';
import { FunctionName, functionName } from '../naming';
import { CorsStackProps, resolveAllowedOrigin } from './shared';

/**
 * REST API (API Gateway), the phone's API key and its usage plan.
 *
 * The Lambdas come from the Lambda stack and are looked up by name; this stack adds the
 * permissions that let API Gateway invoke them. Deploy the Lambda stack before this one
 * the first time.
 */
export class ApiStack extends cdk.Stack {
  public readonly api: TelemetryApi;

  constructor(scope: Construct, id: string, props: CorsStackProps) {
    super(scope, id, props);

    const importFunction = (name: FunctionName) =>
      lambda.Function.fromFunctionAttributes(this, `${name}Function`, {
        functionArn: this.formatArn({
          service: 'lambda',
          resource: 'function',
          resourceName: functionName(props.projectName, name),
          arnFormat: cdk.ArnFormat.COLON_RESOURCE_NAME,
        }),
        // Same account and region: lets this stack add the invoke permissions for API Gateway.
        sameEnvironment: true,
      });

    const allowedOrigin = resolveAllowedOrigin(this, props.projectName, props.allowedOrigin);

    this.api = new TelemetryApi(this, 'Api', {
      projectName: props.projectName,
      functions: {
        ingestFunction: importFunction('ingest'),
        queryFunction: importFunction('query'),
        batteryFunction: importFunction('battery'),
        connectivityFunction: importFunction('connectivity'),
      },
      allowedOrigin,
    });

    new cdk.CfnOutput(this, 'ApiBaseUrl', {
      value: this.api.baseUrl,
      description: 'Base URL for the dashboard and the mobile app; routes start with /api/...',
    });
    new cdk.CfnOutput(this, 'AllowedOrigin', {
      value: allowedOrigin,
      description: 'CORS origin the API accepts',
    });
    new cdk.CfnOutput(this, 'IngestionApiKeyId', {
      value: this.api.ingestionApiKey.keyId,
      description: 'Id of the x-api-key for POST /api/telemetry (see GetIngestionApiKeyCommand)',
    });
    new cdk.CfnOutput(this, 'GetIngestionApiKeyCommand', {
      value: cdk.Fn.join('', [
        'aws apigateway get-api-key --region ', this.region,
        ' --api-key ', this.api.ingestionApiKey.keyId,
        ' --include-value --query value --output text',
      ]),
      description: 'Prints the API key value (INGESTION_API_KEY of the mobile app)',
    });
  }
}
