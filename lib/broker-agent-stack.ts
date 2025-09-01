import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as bedrock from 'aws-cdk-lib/aws-bedrock';
import * as stepfunctions from 'aws-cdk-lib/aws-stepfunctions';
import * as stepfunctionsTasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { AwsCustomResource, AwsCustomResourcePolicy, PhysicalResourceId } from 'aws-cdk-lib/custom-resources';
import * as path from 'path';

export class BrokerAgentStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const uid = 'broker-agent';

    // Source bucket configuration
    const policySourceBucket = new s3.Bucket(this, `${uid}-policy-source-bucket`, {
      bucketName: `${uid}-policy-source-bucket`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // Vector bucket configuration
    const policyVectorBucketName = `${uid}-policy-vector-bucket`;

    // Create Lambda function for vector bucket operations. TEMP UNTIL S3 VECTOR CDK SUPPORT
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

    // Custom resource for vector bucket creation. TEMP CR UNTIL S3 VECTOR CDK SUPPORT
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

    // Custom resource for vector index creation. TEMP CR UNTIL S3 VECTOR CDK SUPPORT
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
    
    // Create IAM role for Bedrock knowledge base
    const kbRole = new iam.Role(this, `${uid}-bedrock-kb-role`, {
      assumedBy: new iam.ServicePrincipal('bedrock.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonBedrockFullAccess'),
      ],
    });

    kbRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        's3vectors:*',
        's3:*'
      ],
      resources: ['*']
    }));

    // Knowledge base configuration
    const knowledgeBaseName = `${uid}-bedrock-kb`;

    // Create Lambda function for knowledge base operations
    const createKnowledgeBaseLambda = new lambda.Function(this, `${uid}-create-bedrock-kb-function`, {
      runtime: lambda.Runtime.PYTHON_3_9,
      handler: 'create_knowledge_base.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, "..", "src"), {
        bundling: {
          image: lambda.Runtime.PYTHON_3_9.bundlingImage,
          command: [
            'bash', '-c',
            'pip install -r requirements.txt -t /asset-output && cp -au . /asset-output'
          ],
        },
      }),
      timeout: cdk.Duration.minutes(15), // Longer timeout for knowledge base creation
    });

    // Grant permissions to the knowledge base Lambda function
    createKnowledgeBaseLambda.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'bedrock:CreateKnowledgeBase',
        'bedrock:GetKnowledgeBase',
        'bedrock:DeleteKnowledgeBase',
        'bedrock:ListKnowledgeBases',
        'iam:PassRole'
      ],
      resources: ['*']
    }));

    // Custom resource for knowledge base creation
    const knowledgeBaseCr = new AwsCustomResource(this, `${knowledgeBaseName}-cr`, {
      onCreate: {
        service: "Lambda",
        action: "invoke",
        parameters: {
          FunctionName: createKnowledgeBaseLambda.functionName,
          Payload: JSON.stringify({
            kb_name: knowledgeBaseName,
            role_arn: kbRole.roleArn,
            region_name: this.region,
            account_id: this.account,
            vector_store_name: policyVectorBucketName,
            vector_index_name: policyVectorIndexName,
          })
        },
        physicalResourceId: PhysicalResourceId.of(
          `${knowledgeBaseName}-cr-on-create`,
        ),
      },
      onUpdate: {
        service: "STS",
        action: "getCallerIdentity",
        physicalResourceId: PhysicalResourceId.of(
          `${knowledgeBaseName}-cr-on-update`,
        ),
      },
      onDelete: {
        service: "STS",
        action: "getCallerIdentity",
        physicalResourceId: PhysicalResourceId.of(
          `${knowledgeBaseName}-cr-on-delete`,
        ),
      },
      policy: AwsCustomResourcePolicy.fromStatements([
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['lambda:InvokeFunction'],
          resources: [createKnowledgeBaseLambda.functionArn],
        }),
      ]),
    });

    // Ensure knowledge base is created after vector index
    knowledgeBaseCr.node.addDependency(vectorIndexCr);
    knowledgeBaseCr.node.addDependency(kbRole);

    // Create the Knowledge Base. DISABLED UNTIL S3 VECTOR CDK SUPPORT
    // const bedrockKnowledgeBase = new bedrock.CfnKnowledgeBase(this, `${uid}-bedrock-kb`, {
    //   name: `${uid}-bedrock-kb`,
    //   description: 'populate description',
    //   roleArn: kbRole.roleArn,
    //   knowledgeBaseConfiguration: {
    //     type: 'VECTOR',
    //     vectorKnowledgeBaseConfiguration: {
    //       embeddingModelArn: `arn:aws:bedrock:${this.region}::foundation-model/amazon.titan-embed-text-v1`,
    //       embeddingModelConfiguration: {
    //         bedrockEmbeddingModelConfiguration: {
    //           dimensions: vectorDimension,
    //           embeddingDataType: 'FLOAT32'
    //         }
    //       }
    //     },
    //   },
    //   storageConfiguration: {
    //     type: 'S3_VECTORS',
    //     s3VectorsConfiguration: {
    //       indexArn: vectorIndexCr.getResponseField('Payload').toString(),
    //     },
    //   },
    // });

    // Create the data source
    const bedrockDataSource = new bedrock.CfnDataSource(this, `${uid}-bedrock-datasource`, {
      knowledgeBaseId: 'F0RI3FAYPP',
      name: `${uid}-bedrock-datasource`,
      description: 'populate description',
      dataDeletionPolicy: 'DELETE', // When data source is deleted, also delete the data
      dataSourceConfiguration: {
        type: 'S3',
        s3Configuration: {
          bucketArn: policySourceBucket.bucketArn,
        },
      },
      vectorIngestionConfiguration: {
        chunkingConfiguration: {
          chunkingStrategy: 'FIXED_SIZE', // Split documents into chunks of fixed size
          fixedSizeChunkingConfiguration: {
            maxTokens: 300,           // Maximum tokens per chunk
            overlapPercentage: 20     // Overlap between chunks to maintain context
          }
        }
      }
    });

    // Create Lambda function for knowledge base sync operations
    const syncKnowledgeBaseLambda = new lambda.Function(this, `${uid}-sync-knowledge-base-function`, {
      runtime: lambda.Runtime.PYTHON_3_9,
      handler: 'sync_knowledge_base.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, "..", "src"), {
        bundling: {
          image: lambda.Runtime.PYTHON_3_9.bundlingImage,
          command: [
            'bash', '-c',
            'pip install -r requirements.txt -t /asset-output && cp -au . /asset-output'
          ],
        },
      }),
      timeout: cdk.Duration.minutes(15), // Long timeout for ingestion monitoring
      environment: {
        KNOWLEDGE_BASE_ID: 'F0RI3FAYPP', // TODO: Replace with dynamic reference
        DATA_SOURCE_ID: bedrockDataSource.attrDataSourceId,
      },
    });

    // Grant permissions to the sync Lambda function
    syncKnowledgeBaseLambda.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'bedrock:StartIngestionJob',
        'bedrock:GetIngestionJob',
        'bedrock:ListIngestionJobs',
        'bedrock:StopIngestionJob'
      ],
      resources: ['*']
    }));


    // Create Step Function for knowledge base sync with concurrency control
    const checkSyncStatus = new stepfunctions.Pass(this, 'CheckSyncStatus', {
      comment: 'Check if sync is already running',
    });

    const startSyncJob = new stepfunctionsTasks.LambdaInvoke(this, 'StartSyncJob', {
      lambdaFunction: syncKnowledgeBaseLambda,
      payload: stepfunctions.TaskInput.fromObject({
        knowledge_base_id: 'F0RI3FAYPP',
        data_source_id: bedrockDataSource.attrDataSourceId,
      }),
      comment: 'Start knowledge base sync job',
    });

    const waitForSync = new stepfunctions.Wait(this, 'WaitForSync', {
      time: stepfunctions.WaitTime.duration(cdk.Duration.minutes(2)),
      comment: 'Wait before checking sync status',
    });

    const checkJobStatus = new stepfunctionsTasks.LambdaInvoke(this, 'CheckJobStatus', {
      lambdaFunction: syncKnowledgeBaseLambda,
      payload: stepfunctions.TaskInput.fromObject({
        action: 'check_status',
        knowledge_base_id: 'F0RI3FAYPP',
        data_source_id: bedrockDataSource.attrDataSourceId,
      }),
      comment: 'Check sync job status',
    });

    const syncComplete = new stepfunctions.Succeed(this, 'SyncComplete', {
      comment: 'Sync job completed successfully',
    });

    const syncFailed = new stepfunctions.Fail(this, 'SyncFailed', {
      comment: 'Sync job failed',
    });

    // Define Step Function workflow
    const definition = checkSyncStatus
      .next(startSyncJob)
      .next(waitForSync)
      .next(checkJobStatus)
      .next(new stepfunctions.Choice(this, 'IsSyncComplete')
        .when(stepfunctions.Condition.stringEquals('$.Payload.final_status', 'COMPLETE'), syncComplete)
        .when(stepfunctions.Condition.stringEquals('$.Payload.final_status', 'FAILED'), syncFailed)
        .otherwise(waitForSync));

    const syncStateMachine = new stepfunctions.StateMachine(this, `${uid}-sync-state-machine`, {
      stateMachineName: `${uid}-sync-state-machine`,
      definition,
      timeout: cdk.Duration.hours(2), // Allow up to 2 hours for sync
    });

    // Create Lambda function to trigger Step Function from S3 events
    const triggerSyncLambda = new lambda.Function(this, `${uid}-trigger-sync-function`, {
      runtime: lambda.Runtime.PYTHON_3_9,
      handler: 'trigger_sync.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, "..", "src"), {
        bundling: {
          image: lambda.Runtime.PYTHON_3_9.bundlingImage,
          command: [
            'bash', '-c',
            'pip install -r requirements.txt -t /asset-output && cp -au . /asset-output'
          ],
        },
      }),
      timeout: cdk.Duration.minutes(1),
      environment: {
        STATE_MACHINE_ARN: syncStateMachine.stateMachineArn,
        KNOWLEDGE_BASE_ID: 'F0RI3FAYPP',
        DATA_SOURCE_ID: bedrockDataSource.attrDataSourceId,
      },
    });

    // Grant permissions to trigger and list Step Function executions
    triggerSyncLambda.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'states:StartExecution',
        'states:ListExecutions'
      ],
      resources: [syncStateMachine.stateMachineArn],
    }));

    // Add S3 event trigger to Lambda function
    policySourceBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.LambdaDestination(triggerSyncLambda)
    );

    // Deploy policy assets to S3 bucket after all infrastructure is ready
    const assetsPath = path.join(__dirname, "..", "assets");
    const s3DeployPolicies = new s3deploy.BucketDeployment(this, `${uid}-s3-deploy-policies`, {
      sources: [s3deploy.Source.asset(assetsPath)],
      destinationBucket: policySourceBucket,
    });

    // Ensure S3 deployment happens after all infrastructure is provisioned
    s3DeployPolicies.node.addDependency(vectorBucketCr);
    s3DeployPolicies.node.addDependency(vectorIndexCr);
    s3DeployPolicies.node.addDependency(knowledgeBaseCr);
    s3DeployPolicies.node.addDependency(bedrockDataSource);
    s3DeployPolicies.node.addDependency(syncStateMachine);
    s3DeployPolicies.node.addDependency(triggerSyncLambda);

    // Output the policy vector bucket name for reference
    new cdk.CfnOutput(this, 'PolicyVectorBucketName', {
      value: policyVectorBucketName,
      description: 'Name of the policy vector bucket',
    });

    // Output the source bucket name for reference
    new cdk.CfnOutput(this, 'PolicySourceBucketName', {
      value: policySourceBucket.bucketName,
      description: 'Name of the policy source bucket where files are uploaded',
    });
  }
}
