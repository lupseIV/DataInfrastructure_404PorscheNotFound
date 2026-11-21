import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { siteBucketName } from './naming';

export interface GithubDeployRoleStackProps extends cdk.StackProps {
  /** Prefix used for resource names, e.g. "fleet-telemetry". */
  readonly projectName: string;
  /** GitHub repository allowed to deploy, as "owner/name". */
  readonly githubRepo: string;
  /**
   * Subject prefix GitHub uses when the repository has "immutable subject" enabled:
   * owner and repo carry their numeric ids, e.g. "repo:owner@123/name@456".
   * Check it with GET /repos/{owner}/{repo}/actions/oidc/customization/sub (sub_claim_prefix).
   * Both this and the plain "repo:owner/name" form are accepted.
   * @default - only the plain form is accepted
   */
  readonly githubImmutableSubjectPrefix?: string;
  /** Branch allowed to deploy. @default 'main' */
  readonly deployBranch?: string;
  /**
   * ARN of an existing GitHub OIDC provider in the account. An account can only have one
   * provider per URL, so pass this if token.actions.githubusercontent.com already exists.
   * @default - a new provider is created
   */
  readonly existingOidcProviderArn?: string;
}

/**
 * One-time setup, deployed manually by someone with IAM permissions:
 * lets GitHub Actions deploy without stored AWS keys (OpenID Connect).
 *
 * The role can only be assumed by workflows of `githubRepo` running on `deployBranch`.
 * Permissions, one block per workflow:
 * - infra-deploy.yml:    assume the CDK bootstrap roles (they do the deployment), read outputs
 * - lambda-deploy.yml:   update the code of the project's Lambda functions
 * - frontend-deploy.yml: write to the site bucket and invalidate CloudFront
 */
export class GithubDeployRoleStack extends cdk.Stack {
  public readonly role: iam.Role;

  constructor(scope: Construct, id: string, props: GithubDeployRoleStackProps) {
    super(scope, id, props);

    const issuer = 'token.actions.githubusercontent.com';
    const providerArn =
      props.existingOidcProviderArn ??
      new iam.OidcProviderNative(this, 'GithubOidcProvider', {
        url: `https://${issuer}`,
        clientIds: ['sts.amazonaws.com'],
      }).oidcProviderArn;

    const branch = props.deployBranch ?? 'main';
    // A list in StringEquals matches if the token's subject equals any of the values.
    const allowedSubjects = [
      `repo:${props.githubRepo}:ref:refs/heads/${branch}`,
      ...(props.githubImmutableSubjectPrefix
        ? [`${props.githubImmutableSubjectPrefix}:ref:refs/heads/${branch}`]
        : []),
    ];

    this.role = new iam.Role(this, 'DeployRole', {
      roleName: `${props.projectName}-github-deploy`,
      description: `GitHub Actions deploy role for ${props.githubRepo} (${branch})`,
      maxSessionDuration: cdk.Duration.hours(1),
      assumedBy: new iam.WebIdentityPrincipal(providerArn, {
        StringEquals: {
          [`${issuer}:aud`]: 'sts.amazonaws.com',
          [`${issuer}:sub`]: allowedSubjects,
        },
      }),
    });

    // `cdk deploy` works by assuming the bootstrap roles (deploy, file publishing, lookup).
    this.role.addToPolicy(
      new iam.PolicyStatement({
        actions: ['sts:AssumeRole', 'sts:TagSession'],
        resources: [`arn:${this.partition}:iam::${this.account}:role/cdk-hnb659fds-*-${this.account}-${this.region}`],
      }),
    );

    // Read stack outputs (API URL, bucket name, ...) in later workflow steps.
    this.role.addToPolicy(
      new iam.PolicyStatement({
        actions: ['cloudformation:DescribeStacks'],
        resources: [`arn:${this.partition}:cloudformation:${this.region}:${this.account}:stack/${props.projectName}-*/*`],
      }),
    );

    // lambda-deploy.yml: update the code of the existing functions.
    this.role.addToPolicy(
      new iam.PolicyStatement({
        actions: ['lambda:UpdateFunctionCode', 'lambda:GetFunction', 'lambda:GetFunctionConfiguration'],
        resources: [`arn:${this.partition}:lambda:${this.region}:${this.account}:function:${props.projectName}-*`],
      }),
    );

    // frontend-deploy.yml: upload the dashboard build and invalidate the CDN cache.
    const bucketArn = `arn:${this.partition}:s3:::${siteBucketName(props.projectName, this.account, this.region)}`;
    this.role.addToPolicy(
      new iam.PolicyStatement({
        actions: ['s3:ListBucket'],
        resources: [bucketArn],
      }),
    );
    this.role.addToPolicy(
      new iam.PolicyStatement({
        actions: ['s3:PutObject', 's3:DeleteObject'],
        resources: [`${bucketArn}/*`],
      }),
    );
    this.role.addToPolicy(
      new iam.PolicyStatement({
        actions: ['cloudfront:CreateInvalidation', 'cloudfront:GetInvalidation'],
        resources: [`arn:${this.partition}:cloudfront::${this.account}:distribution/*`],
      }),
    );

    new cdk.CfnOutput(this, 'DeployRoleArn', {
      value: this.role.roleArn,
      description: 'Save as the GitHub repository secret AWS_DEPLOY_ROLE_ARN',
    });
  }
}
