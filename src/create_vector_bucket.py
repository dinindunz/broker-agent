import boto3
from botocore.exceptions import ClientError

def create_vector_bucket(vector_bucket_name):
    """Create an S3 Vector bucket and return its ARN"""
    try:
        # Initialize S3 vectors client
        s3vectors = boto3.client('s3vectors')
        
        # Create the vector bucket
        s3vectors.create_vector_bucket(vectorBucketName=vector_bucket_name)
        print(f"✅ Vector bucket '{vector_bucket_name}' created successfully")
        
        # Get the vector bucket details
        response = s3vectors.get_vector_bucket(vectorBucketName=vector_bucket_name)
        bucket_info = response.get("vectorBucket", {})
        vector_store_arn = bucket_info.get("vectorBucketArn")
        
        if not vector_store_arn:
            raise ValueError("Vector bucket ARN not found in response")
            
        print(f"Vector bucket ARN: {vector_store_arn}")
        return vector_store_arn
    except ClientError as e:
        error_code = e.response.get('Error', {}).get('Code', 'Unknown')
        error_message = e.response.get('Error', {}).get('Message', 'Unknown error')
        print(f"❌ Error creating vector bucket: {error_code} - {error_message}")
        raise

# Create the vector bucket
def handler(event, context):
    """Lambda handler for vector bucket operations"""
    vector_bucket_name = event.get('vector_bucket_name', 'default-vector-bucket')
    vector_bucket_arn = create_vector_bucket(vector_bucket_name)
    return {
        'vector_bucket_arn': vector_bucket_arn,
        'status': 'success'
    }
