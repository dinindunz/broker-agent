import boto3
import time
from botocore.exceptions import ClientError


def create_knowledge_base(
    bedrock_client,
    kb_name,
    role_arn,
    region_name,
    account_id,
    vector_store_name,
    vector_index_name,
):
    """
    Create a Bedrock Knowledge Base with S3 Vector Store

    Args:
        bedrock_client: Boto3 client for Bedrock
        kb_name: Name for the knowledge base
        role_arn: IAM role ARN for the knowledge base
        region_name: AWS region
        account_id: AWS account ID
        vector_store_name: Name of the vector store
        vector_index_name: Name of the vector index

    Returns:
        str: Knowledge base ID
    """
    try:

        # Create the Knowledge Base
        create_kb_response = bedrock_client.create_knowledge_base(
            name=kb_name,
            description="Amazon Bedrock Knowledge Bases with S3 Vector Store",
            roleArn=role_arn,
            knowledgeBaseConfiguration={
                "type": "VECTOR",
                "vectorKnowledgeBaseConfiguration": {
                    # Specify the embedding model to use
                    "embeddingModelArn": f"arn:aws:bedrock:{region_name}::foundation-model/amazon.titan-embed-text-v2:0",
                    "embeddingModelConfiguration": {
                        "bedrockEmbeddingModelConfiguration": {
                            "dimensions": 1024,  # Should match the vector_dimension we defined earlier
                            "embeddingDataType": "FLOAT32",
                        }
                    },
                },
            },
            storageConfiguration={
                "type": "S3_VECTORS",
                "s3VectorsConfiguration": {
                    "indexArn": f"arn:aws:s3vectors:{region_name}:{account_id}:bucket/{vector_store_name}/index/{vector_index_name}",
                },
            },
        )

        knowledge_base_id = create_kb_response["knowledgeBase"]["knowledgeBaseId"]
        print(f"Knowledge base ID: {knowledge_base_id}")

        print(f"\nWaiting for knowledge base {knowledge_base_id} to finish creating...")

        # Poll for KB creation status
        status = "CREATING"
        start_time = time.time()

        while status == "CREATING":
            # Get current status
            response = bedrock_client.get_knowledge_base(
                knowledgeBaseId=knowledge_base_id
            )

            status = response["knowledgeBase"]["status"]
            elapsed_time = int(time.time() - start_time)

            print(f"Current status: {status} (elapsed time: {elapsed_time}s)")

            if status == "CREATING":
                print("Still creating, checking again in 30 seconds...")
                time.sleep(30)
            else:
                break

        print(f"\n✅ Knowledge base creation completed with status: {status}")
        return knowledge_base_id

    except ClientError as e:
        error_code = e.response.get("Error", {}).get("Code", "Unknown")
        error_message = e.response.get("Error", {}).get("Message", "Unknown error")
        print(f"❌ Failed to create knowledge base: {error_code} - {error_message}")
        raise


def handler(event, context):
    """Lambda handler for knowledge base operations"""
    kb_name = event.get("kb_name")
    role_arn = event.get("role_arn")
    region_name = event.get("region_name", context.invoked_function_arn.split(":")[3])
    account_id = event.get("account_id", context.invoked_function_arn.split(":")[4])
    vector_store_name = event.get("vector_store_name")
    vector_index_name = event.get("vector_index_name")

    if not role_arn:
        raise ValueError("role_arn is required")

    try:
        # Initialize Bedrock client
        bedrock_client = boto3.client("bedrock-agent")

        # Create the knowledge base
        knowledge_base_id = create_knowledge_base(
            bedrock_client,
            kb_name,
            role_arn,
            region_name,
            account_id,
            vector_store_name,
            vector_index_name,
        )

        return {"knowledge_base_id": knowledge_base_id, "status": "success"}
    except Exception as e:
        print(f"Error: {str(e)}")
        raise
