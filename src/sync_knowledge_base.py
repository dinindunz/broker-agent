import boto3
import time
import json
from botocore.exceptions import ClientError

def check_running_ingestion_jobs(bedrock_client, knowledge_base_id, data_source_id):
    """
    Check if there are any running ingestion jobs for the knowledge base
    
    Args:
        bedrock_client: Boto3 client for Bedrock
        knowledge_base_id: ID of the knowledge base
        data_source_id: ID of the data source
        
    Returns:
        bool: True if there are running jobs, False otherwise
    """
    try:
        response = bedrock_client.list_ingestion_jobs(
            knowledgeBaseId=knowledge_base_id,
            dataSourceId=data_source_id,
            maxResults=10
        )
        
        # Check if any jobs are currently running
        for job in response.get('ingestionJobSummaries', []):
            if job['status'] in ['STARTING', 'IN_PROGRESS']:
                print(f"Found running ingestion job: {job['ingestionJobId']} with status: {job['status']}")
                return True
        
        return False
    except ClientError as e:
        print(f"Error checking ingestion jobs: {e}")
        return False

def start_ingestion_job(bedrock_client, knowledge_base_id, data_source_id):
    """
    Start a knowledge base ingestion job and monitor its progress
    
    Args:
        bedrock_client: Boto3 client for Bedrock
        knowledge_base_id: ID of the knowledge base
        data_source_id: ID of the data source
        
    Returns:
        dict: Final job statistics and status
    """
    try:
        # Start the ingestion job
        response_ingestion = bedrock_client.start_ingestion_job(
            dataSourceId=data_source_id,
            description='Automated sync triggered by S3 file upload',
            knowledgeBaseId=knowledge_base_id
        )

        ingestion_job_id = response_ingestion['ingestionJob']['ingestionJobId']
        print(f"Started ingestion job: {ingestion_job_id}")
        
        # Monitor the ingestion job progress
        status = "STARTING"
        start_time = time.time()

        print("Monitoring ingestion job progress:")
        print("-" * 50)

        while status in ["STARTING", "IN_PROGRESS"]:
            # Get current status
            response = bedrock_client.get_ingestion_job(
                dataSourceId=data_source_id,
                knowledgeBaseId=knowledge_base_id,
                ingestionJobId=ingestion_job_id
            )
            
            status = response['ingestionJob']['status']
            elapsed_time = int(time.time() - start_time)
            
            # Get current statistics
            stats = response['ingestionJob']['statistics']
            
            # Print updated status
            print(f"Status: {status} (elapsed time: {elapsed_time}s)")
            print(f"Documents scanned: {stats['numberOfDocumentsScanned']}")
            print(f"Documents indexed: {stats['numberOfNewDocumentsIndexed']}")
            print(f"Documents failed: {stats['numberOfDocumentsFailed']}")
            
            if status in ["STARTING", "IN_PROGRESS"]:
                print("Checking again in 30 seconds...\n")
                time.sleep(30)
            else:
                break

        print("-" * 50)
        if status == "COMPLETE":
            print(f"✅ Ingestion job completed successfully")
        else:
            print(f"⚠️ Ingestion job ended with status: {status}")
            
        # Print final statistics
        final_stats = response['ingestionJob']['statistics']
        print(f"\nFinal statistics:")
        print(f"  • Documents scanned: {final_stats['numberOfDocumentsScanned']}")
        print(f"  • Documents indexed: {final_stats['numberOfNewDocumentsIndexed']}")
        print(f"  • Documents failed: {final_stats['numberOfDocumentsFailed']}")
        print(f"  • Total elapsed time: {elapsed_time} seconds")
        
        return {
            'ingestion_job_id': ingestion_job_id,
            'status': status,
            'statistics': final_stats,
            'elapsed_time': elapsed_time
        }

    except ClientError as e:
        error_code = e.response.get('Error', {}).get('Code', 'Unknown')
        error_message = e.response.get('Error', {}).get('Message', 'Unknown error')
        print(f"❌ Failed to start or monitor ingestion job: {error_code} - {error_message}")
        raise

def handler(event, context):
    """
    Lambda handler for knowledge base sync operations
    Triggered by S3 file uploads
    """
    print(f"Event: {json.dumps(event)}")
    
    # Extract parameters from event
    knowledge_base_id = event.get('knowledge_base_id')
    data_source_id = event.get('data_source_id')
    
    if not knowledge_base_id or not data_source_id:
        raise ValueError("knowledge_base_id and data_source_id are required")
    
    try:
        # Initialize Bedrock client
        bedrock_client = boto3.client('bedrock-agent')
        
        # Check if there are any running ingestion jobs
        if check_running_ingestion_jobs(bedrock_client, knowledge_base_id, data_source_id):
            print("⚠️ Ingestion job already running. Skipping new job to avoid conflicts.")
            return {
                'status': 'skipped',
                'message': 'Ingestion job already running'
            }
        
        # Start the ingestion job
        result = start_ingestion_job(bedrock_client, knowledge_base_id, data_source_id)
        
        return {
            'status': 'success',
            'ingestion_job_id': result['ingestion_job_id'],
            'final_status': result['status'],
            'statistics': result['statistics'],
            'elapsed_time': result['elapsed_time']
        }
        
    except Exception as e:
        print(f"Error: {str(e)}")
        raise
