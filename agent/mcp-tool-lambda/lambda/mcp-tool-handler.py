"""
Broker Agent Gateway Lambda Handler
Handles lending policy retrieval tools via Bedrock Knowledge Base integration
Updated for broker operations - SDK only implementation
"""
import json
import logging
import os
import boto3
from datetime import datetime
from typing import Dict, Any, Optional

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Initialize Bedrock clients
try:
    bedrock_agent_runtime = boto3.client('bedrock-agent-runtime', region_name='ap-southeast-2')
    BEDROCK_AVAILABLE = True
    logger.info("Bedrock Agent Runtime client initialized successfully")
except Exception as e:
    BEDROCK_AVAILABLE = False
    logger.error(f"Failed to initialize Bedrock client: {e}")

# Tool configurations
BASIC_TOOLS = ['get_time']
BROKER_TOOLS = ['retrieve_policy']
ALL_TOOLS = BASIC_TOOLS + BROKER_TOOLS

# Knowledge Base configuration - these should be set via environment variables
KNOWLEDGE_BASE_ID = os.environ.get('KNOWLEDGE_BASE_ID', '')
if not KNOWLEDGE_BASE_ID:
    logger.warning("KNOWLEDGE_BASE_ID environment variable not set")


def extract_tool_name(context, event: Dict[str, Any]) -> Optional[str]:
    """Extract tool name from Gateway context or event."""
    
    # Try Gateway context first
    if hasattr(context, 'client_context') and context.client_context:
        if hasattr(context.client_context, 'custom') and context.client_context.custom:
            tool_name = context.client_context.custom.get('bedrockAgentCoreToolName')
            if tool_name and '___' in tool_name:
                # Remove namespace prefix (e.g., "broker-tools___retrieve_policy" -> "retrieve_policy")
                return tool_name.split('___', 1)[1]
            elif tool_name:
                return tool_name
    
    # Fallback to event-based extraction
    for field in ['tool_name', 'toolName', 'name', 'method', 'action', 'function']:
        if field in event:
            return event[field]
    
    # Infer from event structure
    if isinstance(event, dict):
        if len(event) == 0:
            return 'get_time'  # Empty args typically means get_time
        elif 'query' in event:
            return 'retrieve_policy'  # Query parameter indicates policy retrieval
    
    return None


def handle_get_time(event: Dict[str, Any]) -> Dict[str, Any]:
    """Handle get_time tool."""
    current_time = datetime.utcnow().isoformat() + 'Z'
    
    return {
        'success': True,
        'result': f"Current UTC time: {current_time}",
        'tool': 'get_time',
        'timestamp': current_time
    }


def handle_retrieve_policy(event: Dict[str, Any]) -> Dict[str, Any]:
    """Handle retrieve_policy tool using Bedrock Knowledge Base."""
    
    # Check if Bedrock is available
    if not BEDROCK_AVAILABLE:
        return {
            'success': False,
            'error': "Bedrock Agent Runtime not available. Please check Lambda configuration.",
            'tool': 'retrieve_policy',
            'timestamp': datetime.utcnow().isoformat() + 'Z'
        }
    
    # Check if Knowledge Base ID is configured
    if not KNOWLEDGE_BASE_ID:
        return {
            'success': False,
            'error': "Knowledge Base ID not configured. Please set KNOWLEDGE_BASE_ID environment variable.",
            'tool': 'retrieve_policy',
            'timestamp': datetime.utcnow().isoformat() + 'Z'
        }
    
    try:
        # Get the query from the event
        user_query = event.get('query', '')
        if not user_query:
            return {
                'success': False,
                'error': "Missing required 'query' parameter for retrieve_policy",
                'tool': 'retrieve_policy',
                'timestamp': datetime.utcnow().isoformat() + 'Z'
            }
        
        logger.info(f"Retrieving policy information for query: {user_query}")
        
        # Call Bedrock Knowledge Base retrieve API
        response = bedrock_agent_runtime.retrieve(
            knowledgeBaseId=KNOWLEDGE_BASE_ID,
            retrievalQuery={
                'text': user_query
            },
            retrievalConfiguration={
                'vectorSearchConfiguration': {
                    'numberOfResults': 5,  # Retrieve top 5 most relevant results
                    'overrideSearchType': 'HYBRID'  # Use hybrid search for better results
                }
            }
        )
        
        # Process the retrieval results
        retrieval_results = response.get('retrievalResults', [])
        
        if not retrieval_results:
            return {
                'success': True,
                'result': "No relevant policy information found for your query. Please try rephrasing your question or use more specific terms.",
                'tool': 'retrieve_policy',
                'query': user_query,
                'results_count': 0,
                'timestamp': datetime.utcnow().isoformat() + 'Z'
            }
        
        # Format the results
        formatted_results = []
        for i, result in enumerate(retrieval_results, 1):
            content = result.get('content', {}).get('text', '')
            score = result.get('score', 0)
            location = result.get('location', {})
            
            # Extract source information
            source_info = ""
            if location:
                s3_location = location.get('s3Location', {})
                if s3_location:
                    uri = s3_location.get('uri', '')
                    if uri:
                        # Extract filename from S3 URI
                        filename = uri.split('/')[-1] if '/' in uri else uri
                        source_info = f" (Source: {filename})"
            
            formatted_result = f"Result {i} (Relevance: {score:.3f}){source_info}:\n{content}\n"
            formatted_results.append(formatted_result)
        
        # Combine all results
        combined_results = "\n".join(formatted_results)
        
        # Create a comprehensive response
        response_text = f"Found {len(retrieval_results)} relevant policy documents for your query:\n\n{combined_results}"
        
        logger.info(f"Successfully retrieved {len(retrieval_results)} policy results")
        
        return {
            'success': True,
            'result': response_text,
            'tool': 'retrieve_policy',
            'query': user_query,
            'results_count': len(retrieval_results),
            'knowledge_base_id': KNOWLEDGE_BASE_ID,
            'timestamp': datetime.utcnow().isoformat() + 'Z'
        }
        
    except Exception as e:
        logger.error(f"Policy retrieval error: {str(e)}")
        return {
            'success': False,
            'error': f"Policy Retrieval Error: {str(e)}",
            'tool': 'retrieve_policy',
            'query': user_query if 'user_query' in locals() else 'unknown',
            'timestamp': datetime.utcnow().isoformat() + 'Z'
        }


def lambda_handler(event, context):
    """
    Broker Agent Gateway Lambda Handler
    
    Handles basic tools (get_time) and broker-specific tools (retrieve_policy)
    via Bedrock Knowledge Base integration.
    """
    logger.info("Broker Agent Gateway Lambda Handler - START")
    logger.info(f"Event: {json.dumps(event, default=str)}")
    
    try:
        # Extract tool name
        tool_name = extract_tool_name(context, event)
        logger.info(f"Tool: {tool_name}")
        
        if not tool_name:
            return {
                'success': False,
                'error': 'Unable to determine tool name from context or event',
                'available_tools': ALL_TOOLS,
                'timestamp': datetime.utcnow().isoformat() + 'Z'
            }
        
        # Route to appropriate handler
        if tool_name == 'get_time':
            return handle_get_time(event)
        
        elif tool_name == 'retrieve_policy':
            return handle_retrieve_policy(event)
        
        else:
            # Unknown tool
            return {
                'success': False,
                'error': f"Unknown tool: {tool_name}",
                'available_tools': ALL_TOOLS,
                'total_tools': len(ALL_TOOLS),
                'categories': {
                    'basic': BASIC_TOOLS,
                    'broker_tools': BROKER_TOOLS
                },
                'tool': tool_name,
                'timestamp': datetime.utcnow().isoformat() + 'Z'
            }
    
    except Exception as e:
        logger.error(f"Handler error: {str(e)}")
        return {
            'success': False,
            'error': f"Internal error: {str(e)}",
            'timestamp': datetime.utcnow().isoformat() + 'Z'
        }
    
    finally:
        logger.info("Broker Agent Gateway Lambda Handler - END")
