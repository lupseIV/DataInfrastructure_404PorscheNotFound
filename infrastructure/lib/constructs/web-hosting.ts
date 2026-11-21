import * as cdk from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

/** Apps served by the distribution, each from its own prefix in the bucket. */
export const WEB_APPS = ['dashboard', 'mobile'] as const;

export interface WebHostingProps {
  /** Prefix used for resource names, e.g. "fleet-telemetry". */
  readonly projectName: string;
}

/**
 * Static hosting for the web dashboard and the mobile web app (PWA).
 *
 * One private S3 bucket behind one CloudFront distribution (HTTPS, required by the
 * phone's motion and battery APIs):
 *
 *   https://<domain>/            -> redirects to /dashboard/
 *   https://<domain>/dashboard/  -> s3://<bucket>/dashboard/   (build of src/web-dashboard)
 *   https://<domain>/mobile/     -> s3://<bucket>/mobile/      (build of src/mobile-app)
 *
 * Both apps share one origin, so a single CORS origin on the API covers both.
 * Paths without a file extension are served the app's index.html, so client-side
 * routing works. Files are uploaded by the CI/CD pipeline, not by CDK.
 */
export class WebHosting extends Construct {
  public readonly bucket: s3.Bucket;
  public readonly distribution: cloudfront.Distribution;

  constructor(scope: Construct, id: string, props: WebHostingProps) {
    super(scope, id);

    this.bucket = new s3.Bucket(this, 'SiteBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      // Hackathon environment: empty and delete the bucket with the stack.
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const routing = new cloudfront.Function(this, 'SpaRouting', {
      functionName: `${props.projectName}-spa-routing`,
      comment: 'Redirect / to /dashboard/ and serve index.html for client-side routes',
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      code: cloudfront.FunctionCode.fromInline(spaRoutingCode()),
    });

    this.distribution = new cloudfront.Distribution(this, 'Distribution', {
      comment: `${props.projectName} web apps`,
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(this.bucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        compress: true,
        functionAssociations: [
          { function: routing, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST },
        ],
      },
      // Cheapest tier: edge locations in Europe and North America only.
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
    });
  }

  /** https://<distribution domain>, used as the API's CORS origin. */
  public get origin(): string {
    return `https://${this.distribution.distributionDomainName}`;
  }
}

function spaRoutingCode(): string {
  const apps = WEB_APPS.join('|');
  return `
function redirect(location) {
  return { statusCode: 302, statusDescription: 'Found', headers: { location: { value: location } } };
}

function handler(event) {
  var request = event.request;
  var uri = request.uri;

  if (uri === '/' || uri === '') {
    return redirect('/dashboard/');
  }

  var match = uri.match(/^\\/(${apps})(\\/.*)?$/);
  if (!match) {
    return request;
  }

  var app = match[1];
  var rest = match[2] || '';
  if (rest === '') {
    return redirect('/' + app + '/');
  }

  // No file extension in the last segment -> client-side route, serve the app shell.
  var lastSegment = rest.substring(rest.lastIndexOf('/') + 1);
  if (lastSegment.indexOf('.') === -1) {
    request.uri = '/' + app + '/index.html';
  }
  return request;
}
`.trim();
}
