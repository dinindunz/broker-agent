import json
import boto3
from datetime import datetime
import os

def handler(event, context):
    """
    Lambda handler to trigger Step Function executions from S3 events
    Checks if Step Function is already running before starting a new execution
    """
    stepfunctions = boto3.client('stepfunctions')
    
    # Get environment variables
    state_machine_arn = os.environ.get('STATE_MACHINE_ARN')
    knowledge_base_id = os.environ.get('KNOWLEDGE_BASE_ID')
    data_source_id = os.environ.get('DATA_SOURCE_ID')
    
    if not all([state_machine_arn, knowledge_base_id, data_source_id]):
        raise ValueError("Missing required environment variables")
    
    # Check if there are any running executions
    try:
        response = stepfunctions.list_executions(
            stateMachineArn=state_machine_arn,
            statusFilter='RUNNING',
            maxResults=1
        )
        
        running_executions = response.get('executions', [])
        
        if running_executions:
            print(f"Step Function execution already running: {running_executions[0]['executionArn']}")
            print("Skipping new execution to avoid conflicts")
            return {
                'statusCode': 200, 
                'message': 'Execution already running',
                'running_execution': running_executions[0]['executionArn']
            }
        
        # No running executions, safe to start a new one
        for record in event['Records']:
            bucket = record['s3']['bucket']['name']
            key = record['s3']['object']['key']
            
            print(f"Starting Step Function for file: {key} in bucket: {bucket}")
            
            # Start Step Function execution
            execution_name = f'sync-{int(datetime.now().timestamp())}'
            response = stepfunctions.start_execution(
                stateMachineArn=state_machine_arn,
                name=execution_name,
                input=json.dumps({
                    'bucket': bucket,
                    'key': key,
                    'knowledge_base_id': knowledge_base_id,
                    'data_source_id': data_source_id,
                    'trigger_time': datetime.now().isoformat()
                })
            )
            
            print(f"Started Step Function execution: {response['executionArn']}")
            
            return {
                'statusCode': 200, 
                'message': 'Step Function started',
                'execution_arn': response['executionArn'],
                'execution_name': execution_name,
                'triggered_by': key
            }
        
        return {'statusCode': 200, 'message': 'No S3 records to process'}
        
    except Exception as e:
        print(f"Error: {str(e)}")
        return {
            'statusCode': 500, 
            'error': str(e),
            'message': 'Failed to trigger Step Function'
        }
