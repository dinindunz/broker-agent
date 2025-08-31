import boto3
from botocore.exceptions import ClientError


def create_and_get_index_arn(
    s3vectors_client, vector_bucket_name, vector_index_name, vector_dimension
):
    """
    Create a vector index in the specified vector bucket and return its ARN

    Args:
        s3vectors_client: Boto3 client for S3 Vectors
        vector_bucket_name: Name of the vector bucket
        vector_index_name: Name for the new index
        vector_dimension: Dimension of the vectors (e.g., 1024 for Titan Embed)

    Returns:
        str: ARN of the created index
    """
    # Define index configuration
    index_config = {
        "vectorBucketName": vector_bucket_name,
        "indexName": vector_index_name,
        "dimension": vector_dimension,
        "distanceMetric": "cosine",  # Using cosine similarity as our metric
        "dataType": "float32",  # Standard for most embedding models
        "metadataConfiguration": {
            "nonFilterableMetadataKeys": [
                "AMAZON_BEDROCK_TEXT"
            ]  # Text content won't be used for filtering
        },
    }

    try:
        # Create the index
        s3vectors_client.create_index(**index_config)
        print(f"✅ Vector index '{vector_index_name}' created successfully")

        # Get the index ARN
        response = s3vectors_client.list_indexes(vectorBucketName=vector_bucket_name)
        index_arn = response.get("indexes", [{}])[0].get("indexArn")

        if not index_arn:
            raise ValueError("Index ARN not found in response")

        print(f"Vector index ARN: {index_arn}")
        return index_arn

    except ClientError as e:
        error_code = e.response.get("Error", {}).get("Code", "Unknown")
        error_message = e.response.get("Error", {}).get("Message", "Unknown error")
        print(f"❌ Failed to create or retrieve index: {error_code} - {error_message}")
        raise


def handler(event, context):
    """Lambda handler for vector index operations"""
    vector_bucket_name = event.get("vector_bucket_name")
    vector_index_name = event.get("vector_index_name")
    vector_dimension = event.get("vector_dimension")

    try:
        # Initialize S3 vectors client
        s3vectors = boto3.client("s3vectors")

        # Create the vector index
        vector_index_arn = create_and_get_index_arn(
            s3vectors, vector_bucket_name, vector_index_name, vector_dimension
        )

        return {"vector_index_arn": vector_index_arn, "status": "success"}
    except Exception as e:
        print(f"Error: {str(e)}")
        raise
