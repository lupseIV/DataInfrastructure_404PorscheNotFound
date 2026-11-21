import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';

/** The Lambdas behind the routes (created by the Lambda stack, looked up by name). */
export interface TelemetryFunctionRefs {
  readonly ingestFunction: lambda.IFunction;
  readonly queryFunction: lambda.IFunction;
  readonly batteryFunction: lambda.IFunction;
  readonly connectivityFunction: lambda.IFunction;
}

export interface TelemetryApiProps {
  /** Prefix used for resource names, e.g. "fleet-telemetry". */
  readonly projectName: string;
  readonly functions: TelemetryFunctionRefs;
  /** Browser origin allowed by CORS, e.g. "https://d123.cloudfront.net" or "*". */
  readonly allowedOrigin: string;
  /**
   * Stage-wide limit for all routes together (requests per second, burst).
   * @default { rateLimit: 10, burstLimit: 20 }
   */
  readonly throttle?: { rateLimit: number; burstLimit: number };
  /**
   * Max ingestion requests per day for the phone's API key. Requests above it get 429.
   * @default 20000 (one batch every 10 s is 8640 per day)
   */
  readonly ingestionDailyQuota?: number;
}

/**
 * REST API in front of the Lambdas (Contracts A and C).
 *
 *   POST /api/telemetry                      -> ingest     (requires x-api-key)
 *   POST /api/events/battery-low             -> battery    (requires x-api-key)
 *   POST /api/events/battery-last-call       -> battery    (requires x-api-key)
 *   POST /api/events/connectivity-degraded   -> connectivity (requires x-api-key)
 *   POST /api/events/connectivity-last-call  -> connectivity (requires x-api-key)
 *   GET  /api/devices                        -> query
 *   GET  /api/devices/{deviceId}/telemetry   -> query
 *   GET  /api/devices/{deviceId}/alerts      -> query
 *   GET  /api/devices/{deviceId}/path        -> query
 *
 * API Gateway checks the x-api-key header itself and answers 401 with the contract's body,
 * so the Lambdas never see unauthenticated ingestion requests. Throttling on the stage and
 * a usage plan on the key cap traffic, and with it Lambda invocations and cost.
 */
export class TelemetryApi extends Construct {
  public readonly api: apigateway.RestApi;
  public readonly ingestionApiKey: apigateway.IApiKey;

  constructor(scope: Construct, id: string, props: TelemetryApiProps) {
    super(scope, id);

    const throttle = props.throttle ?? { rateLimit: 10, burstLimit: 20 };
    const corsHeaders = {
      'Access-Control-Allow-Origin': `'${props.allowedOrigin}'`,
      'Access-Control-Allow-Headers': "'Content-Type,x-api-key'",
    };

    this.api = new apigateway.RestApi(this, 'Api', {
      restApiName: `${props.projectName}-api`,
      description: 'Fleet telemetry ingestion and query API',
      endpointTypes: [apigateway.EndpointType.REGIONAL],
      // Execution logging is off, so the account-wide CloudWatch role is not needed.
      cloudWatchRole: false,
      deployOptions: {
        stageName: 'prod',
        throttlingRateLimit: throttle.rateLimit,
        throttlingBurstLimit: throttle.burstLimit,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: [props.allowedOrigin],
        allowMethods: ['GET', 'POST', 'OPTIONS'],
        allowHeaders: ['Content-Type', 'x-api-key'],
      },
    });

    // Contract A: 401 + JSON body for a missing or wrong key (API Gateway's default is 403).
    this.api.addGatewayResponse('InvalidApiKey', {
      type: apigateway.ResponseType.INVALID_API_KEY,
      statusCode: '401',
      responseHeaders: corsHeaders,
      templates: { 'application/json': '{"error": "Invalid or missing x-api-key"}' },
    });
    // CORS headers on API Gateway's own errors (throttling, quota, 5xx) so browsers can read them.
    this.api.addGatewayResponse('Default4xx', {
      type: apigateway.ResponseType.DEFAULT_4XX,
      responseHeaders: corsHeaders,
    });
    this.api.addGatewayResponse('Default5xx', {
      type: apigateway.ResponseType.DEFAULT_5XX,
      responseHeaders: corsHeaders,
    });

    const apiRoot = this.api.root.addResource('api');

    const telemetry = apiRoot.addResource('telemetry');
    telemetry.addMethod('POST', new apigateway.LambdaIntegration(props.functions.ingestFunction), {
      apiKeyRequired: true,
    });

    // Contracts D1 to E2: four routes, two Lambdas. Each Lambda picks the event from the
    // last path segment, so the routes must pass the request path through (proxy integration).
    const events = apiRoot.addResource('events');
    const batteryIntegration = new apigateway.LambdaIntegration(props.functions.batteryFunction);
    const connectivityIntegration = new apigateway.LambdaIntegration(props.functions.connectivityFunction);
    const eventRoutes: Array<[string, apigateway.LambdaIntegration]> = [
      ['battery-low', batteryIntegration],
      ['battery-last-call', batteryIntegration],
      ['connectivity-degraded', connectivityIntegration],
      ['connectivity-last-call', connectivityIntegration],
    ];
    for (const [path, integration] of eventRoutes) {
      events.addResource(path).addMethod('POST', integration, { apiKeyRequired: true });
    }

    const queryIntegration = new apigateway.LambdaIntegration(props.functions.queryFunction);
    const devices = apiRoot.addResource('devices');
    devices.addMethod('GET', queryIntegration);
    const device = devices.addResource('{deviceId}');
    device.addResource('telemetry').addMethod('GET', queryIntegration);
    device.addResource('alerts').addMethod('GET', queryIntegration); // Contract C #3, no API key
    device.addResource('path').addMethod('GET', queryIntegration); // Contract C #4, no API key

    // API key for the phone app; API Gateway generates the value.
    this.ingestionApiKey = this.api.addApiKey('IngestionApiKey', {
      apiKeyName: `${props.projectName}-ingestion-key`,
      description: 'x-api-key used by the mobile app for POST /api/telemetry',
    });

    const usagePlan = this.api.addUsagePlan('IngestionUsagePlan', {
      name: `${props.projectName}-ingestion`,
      throttle: { rateLimit: 5, burstLimit: 10 },
      quota: { limit: props.ingestionDailyQuota ?? 20000, period: apigateway.Period.DAY },
    });
    usagePlan.addApiKey(this.ingestionApiKey);
    usagePlan.addApiStage({ stage: this.api.deploymentStage });
  }

  /** Base URL to use as VITE_API_BASE_URL (no trailing slash). */
  public get baseUrl(): string {
    return cdk.Fn.join('', ['https://', this.api.restApiId, '.execute-api.', cdk.Stack.of(this).region, '.', cdk.Aws.URL_SUFFIX, '/', this.api.deploymentStage.stageName]);
  }
}
