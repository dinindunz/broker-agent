import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import { AwsCustomResource, AwsCustomResourcePolicy, PhysicalResourceId } from 'aws-cdk-lib/custom-resources';
import * as path from 'path';

export class BrokerAgentStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const uid = 'broker-agent';

    // Source bucket configuration
    new s3.Bucket(this, `${uid}-policy-source-bucket`, {
      bucketName: `${uid}-policy-source-bucket`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // Vector bucket configuration
    const policyVectorBucketName = `${uid}-policy-vector-bucket`;

    // Create Lambda function for vector bucket operations
    const createVectorBucketLambda = new lambda.Function(this, `${uid}-create-vector-bucket-function`, {
      runtime: lambda.Runtime.PYTHON_3_9,
      handler: 'create_vector_bucket.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, "..", "src"), {
        bundling: {
          image: lambda.Runtime.PYTHON_3_9.bundlingImage,
          command: [
            'bash', '-c',
            'pip install -r requirements.txt -t /asset-output && cp -au . /asset-output'
          ],
        },
      }),
      timeout: cdk.Duration.minutes(5),
    });

    // Grant permissions to the Lambda function
    createVectorBucketLambda.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        's3vectors:CreateVectorBucket',
        's3vectors:GetVectorBucket',
        's3vectors:DeleteVectorBucket',
        's3vectors:ListVectorBuckets'
      ],
      resources: ['*']
    }));

    // Custom resource for vector bucket creation
    const vectorBucketCr = new AwsCustomResource(this, `${policyVectorBucketName}-cr`, {
      onCreate: {
        service: "Lambda",
        action: "invoke",
        parameters: {
          FunctionName: createVectorBucketLambda.functionName,
          Payload: JSON.stringify({
            vector_bucket_name: policyVectorBucketName,
          })
        },
        physicalResourceId: PhysicalResourceId.of(
          `${policyVectorBucketName}-cr-on-create`,
        ),
      },
      onUpdate: {
        service: "Lambda",
        action: "invoke",
        parameters: {
          FunctionName: createVectorBucketLambda.functionName,
          Payload: JSON.stringify({
            vector_bucket_name: policyVectorBucketName,
          })
        },
        physicalResourceId: PhysicalResourceId.of(
          `${policyVectorBucketName}-cr-on-update`,
        ),
      },
      onDelete: {
        service: "STS",
        action: "getCallerIdentity",
        physicalResourceId: PhysicalResourceId.of(
          `${policyVectorBucketName}-cr-on-delete`,
        ),
      },
      policy: AwsCustomResourcePolicy.fromStatements([
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['lambda:InvokeFunction'],
          resources: [createVectorBucketLambda.functionArn],
        }),
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['sts:GetCallerIdentity'],
          resources: ['*'],
        }),
      ]),
    });

    // Output the policy vector bucket name for reference
    new cdk.CfnOutput(this, 'PolicyVectorBucketName', {
      value: policyVectorBucketName,
      description: 'Name of the policy vector bucket',
    });
  }
}
