import * as cdk from 'aws-cdk-lib';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { WebHosting } from '../constructs/web-hosting';
import { webOriginParameterName } from '../naming';
import { ProjectStackProps } from './shared';

/**
 * Static hosting for the web dashboard: private S3 bucket behind CloudFront.
 *
 * Publishes the dashboard origin (https://<domain>) to SSM so the Lambda and API stacks
 * can use it for CORS without a CloudFormation export.
 */
export class WebStack extends cdk.Stack {
  public readonly web: WebHosting;

  constructor(scope: Construct, id: string, props: ProjectStackProps) {
    super(scope, id, props);

    this.web = new WebHosting(this, 'Web', {
      projectName: props.projectName,
    });

    new ssm.StringParameter(this, 'WebOriginParameter', {
      parameterName: webOriginParameterName(props.projectName),
      stringValue: this.web.origin,
      description: 'Origin of the web dashboard (CloudFront); used as the CORS origin of the API',
    });

    new cdk.CfnOutput(this, 'DashboardUrl', {
      value: `${this.web.origin}/dashboard/`,
      description: 'Web dashboard',
    });
    new cdk.CfnOutput(this, 'SiteOrigin', {
      value: this.web.origin,
      description: 'CloudFront origin of the web apps (also in SSM for CORS)',
    });
    new cdk.CfnOutput(this, 'SiteBucketName', {
      value: this.web.bucket.bucketName,
      description: 'The dashboard build is uploaded to s3://<bucket>/dashboard/',
    });
    new cdk.CfnOutput(this, 'DistributionId', {
      value: this.web.distribution.distributionId,
      description: 'CloudFront distribution id (for cache invalidation after uploads)',
    });
  }
}
