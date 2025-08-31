import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as bedrock from 'aws-cdk-lib/aws-bedrock';
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
        service: "STS",
        action: "getCallerIdentity",
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
      ]),
    });

    // Vector index configuration
    const policyVectorIndexName = `${uid}-policy-vector-index`;
    const vectorDimension = 1024; // Default for Titan Embed

    // Create Lambda function for vector index operations
    const createVectorIndexLambda = new lambda.Function(this, `${uid}-create-vector-index-function`, {
      runtime: lambda.Runtime.PYTHON_3_9,
      handler: 'create_vector_index.handler',
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

    // Grant permissions to the vector index Lambda function
    createVectorIndexLambda.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        's3vectors:CreateIndex',
        's3vectors:GetIndex',
        's3vectors:DeleteIndex',
        's3vectors:ListIndexes'
      ],
      resources: ['*']
    }));

    // Custom resource for vector index creation
    const vectorIndexCr = new AwsCustomResource(this, `${policyVectorIndexName}-cr`, {
      onCreate: {
        service: "Lambda",
        action: "invoke",
        parameters: {
          FunctionName: createVectorIndexLambda.functionName,
          Payload: JSON.stringify({
            vector_bucket_name: policyVectorBucketName,
            vector_index_name: policyVectorIndexName,
            vector_dimension: vectorDimension,
          })
        },
        physicalResourceId: PhysicalResourceId.of(
          `${policyVectorIndexName}-cr-on-create`,
        ),
      },
      onUpdate: {
        service: "Lambda",
        action: "invoke",
        parameters: {
          FunctionName: createVectorIndexLambda.functionName,
          Payload: JSON.stringify({
            vector_bucket_name: policyVectorBucketName,
            vector_index_name: policyVectorIndexName,
            vector_dimension: vectorDimension,
          })
        },
        physicalResourceId: PhysicalResourceId.of(
          `${policyVectorIndexName}-cr-on-update`,
        ),
      },
      onDelete: {
        service: "STS",
        action: "getCallerIdentity",
        physicalResourceId: PhysicalResourceId.of(
          `${policyVectorIndexName}-cr-on-delete`,
        ),
      },
      policy: AwsCustomResourcePolicy.fromStatements([
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['lambda:InvokeFunction'],
          resources: [createVectorIndexLambda.functionArn],
        }),
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['sts:GetCallerIdentity'],
          resources: ['*'],
        }),
      ]),
    });

    // Ensure vector index is created after vector bucket
    vectorIndexCr.node.addDependency(vectorBucketCr);

    // // Create the bedrock knowledge base with the role arn that is referenced in the opensearch data access policy
    // const indexName = 'bedrock-knowledge-base-index';
    
    // // Create IAM role for Bedrock knowledge base
    // const kbRole = new iam.Role(this, 'BedrockKnowledgeBaseRole', {
    //   assumedBy: new iam.ServicePrincipal('bedrock.amazonaws.com'),
    //   managedPolicies: [
    //     iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonBedrockFullAccess'),
    //   ],
    // });

    // const bedrockKnowledgeBase = new bedrock.CfnKnowledgeBase(this, 'KnowledgeBaseDocs', {
    //   name: 'bedrock-kb-docs',
    //   description: 'Bedrock knowledge base that contains a corpus of documents',
    //   roleArn: kbRole.roleArn,
    //   knowledgeBaseConfiguration: {
    //     type: 'VECTOR',
    //     vectorKnowledgeBaseConfiguration: {
    //       embeddingModelArn: `arn:aws:bedrock:${this.region}::foundation-model/amazon.titan-embed-text-v1`,
    //     },
    //   },
    //   storageConfiguration: {
    //     type: 'OPENSEARCH_SERVERLESS',
    //     opensearchServerlessConfiguration: {
    //       collectionArn: cdk.Fn.importValue('OpenSearchCollectionArn'),
    //       vectorIndexName: indexName,
    //       fieldMapping: {
    //         metadataField: 'metadataField',
    //         textField: 'textField',
    //         vectorField: 'vectorField',
    //       },
    //     },
    //   },
    // });

    // Output the policy vector bucket name for reference
    new cdk.CfnOutput(this, 'PolicyVectorBucketName', {
      value: policyVectorBucketName,
      description: 'Name of the policy vector bucket',
    });
  }
}
