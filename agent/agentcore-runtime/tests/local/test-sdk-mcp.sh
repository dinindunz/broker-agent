#!/bin/bash

# Broker Agent SDK test with MCP Gateway integration
echo "🧪 Testing Broker Agent SDK → MCP Gateway → Lambda Tool → Bedrock Knowledge Base (End-to-End)"

# Get current AWS credentials
AWS_ACCESS_KEY_ID=$(aws configure get aws_access_key_id)
AWS_SECRET_ACCESS_KEY=$(aws configure get aws_secret_access_key)
AWS_SESSION_TOKEN=$(aws configure get aws_session_token)
AWS_DEFAULT_REGION=$(aws configure get region || echo "us-east-1")

# Check if we have credentials
if [ -z "$AWS_ACCESS_KEY_ID" ]; then
    echo "❌ No AWS credentials found. Please run 'aws configure' first."
    exit 1
fi

echo "✅ Found AWS credentials for account: $(aws sts get-caller-identity --query Account --output text)"
echo "🌍 Region: $AWS_DEFAULT_REGION"

# Stop any existing container
docker stop test-broker-agent-sdk-mcp 2>/dev/null || true
docker rm test-broker-agent-sdk-mcp 2>/dev/null || true

# Build fresh image with current configuration
echo "🔨 Building fresh Broker Agent SDK image with current configuration..."
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$(dirname "$(dirname "$SCRIPT_DIR")")")"
DEPLOYMENT_DIR="$PROJECT_ROOT/agentcore-runtime/deployment"

cd "$DEPLOYMENT_DIR"
docker build --platform linux/arm64 -t broker-agent-sdk:latest -f Dockerfile.sdk ../../ > /dev/null 2>&1

if [ $? -eq 0 ]; then
    echo "✅ Fresh image built with latest configuration"
else
    echo "❌ Failed to build image"
    exit 1
fi

# Run container with AWS credentials and Knowledge Base ID
echo "🚀 Starting Broker Agent SDK with AWS credentials for MCP testing..."
docker run -d \
  --name test-broker-agent-sdk-mcp \
  -p 8081:8080 \
  -e AWS_ACCESS_KEY_ID="$AWS_ACCESS_KEY_ID" \
  -e AWS_SECRET_ACCESS_KEY="$AWS_SECRET_ACCESS_KEY" \
  -e AWS_SESSION_TOKEN="$AWS_SESSION_TOKEN" \
  -e AWS_DEFAULT_REGION="$AWS_DEFAULT_REGION" \
  -e KNOWLEDGE_BASE_ID="${KNOWLEDGE_BASE_ID:-}" \
  broker-agent-sdk:latest

# Wait for startup and OAuth/MCP initialization
echo "⏳ Waiting for Broker Agent to start and initialize OAuth/MCP..."
sleep 15

# Check if container is running
if ! docker ps | grep -q test-broker-agent-sdk-mcp; then
    echo "❌ Container failed to start. Checking logs..."
    docker logs test-broker-agent-sdk-mcp
    exit 1
fi

# Check container logs for OAuth and MCP initialization
echo "📋 Checking Broker Agent initialization..."
docker logs test-broker-agent-sdk-mcp | grep -E "(OAuth|MCP|Gateway|M2M|token|Broker|✅|❌)" | tail -15

# Test ping endpoint
echo ""
echo "🏓 Testing ping endpoint..."
ping_response=$(curl -s http://localhost:8081/ping)
if [[ $ping_response == *"healthy"* ]]; then
    echo "✅ Ping successful: $ping_response"
else
    echo "❌ Ping failed: $ping_response"
fi

echo ""
echo "🧪 Testing current time via MCP Gateway:"
echo "========================================"

# Create test request for current time
cat > /tmp/test_broker_time_request.json << 'EOF'
{
  "prompt": "What is the current time? Please use the get_time tool to get the current date and time.",
  "session_id": "test-time-mcp-123",
  "actor_id": "user"
}
EOF

echo "Request: Get current time via MCP gateway"
echo "Expected flow: Broker Agent SDK → OAuth M2M Token → MCP Gateway → Lambda Tool → get_time"
echo ""

# Make request with extended timeout for MCP calls
echo "Response (Broker Agent SDK format):"
echo "===================="
timeout 90s curl -s -X POST http://localhost:8081/invocations \
  -H "Content-Type: application/json" \
  -d @/tmp/test_broker_time_request.json

echo ""
echo ""
echo "🧪 Testing lending policy retrieval via MCP Gateway:"
echo "=================================================="

# Create test request for policy retrieval
cat > /tmp/test_broker_policy_request.json << 'EOF'
{
  "prompt": "What are the LVR (Loan-to-Value Ratio) requirements for investment properties? Please search the lending policies using the retrieve_policy tool.",
  "session_id": "test-policy-mcp-123", 
  "actor_id": "user"
}
EOF

echo "Request: Search lending policies for LVR requirements via MCP gateway"
echo "Expected flow: Broker Agent SDK → OAuth M2M Token → MCP Gateway → Lambda Tool → Bedrock Knowledge Base"
echo ""

if [ -z "$KNOWLEDGE_BASE_ID" ]; then
    echo "⚠️  KNOWLEDGE_BASE_ID environment variable not set. Policy retrieval may fail."
    echo "   Set KNOWLEDGE_BASE_ID=your-kb-id before running this test."
    echo ""
fi

echo "Response (Broker Agent SDK format):"
echo "===================="
timeout 90s curl -s -X POST http://localhost:8081/invocations \
  -H "Content-Type: application/json" \
  -d @/tmp/test_broker_policy_request.json

echo ""
echo ""
echo "📋 Full container logs (startup):"
echo "========================================"
docker logs test-broker-agent-sdk-mcp | head -50

echo ""
echo "📋 Full container logs (recent):"
echo "========================================"
docker logs test-broker-agent-sdk-mcp | tail -50

echo ""
echo "🎯 Test Analysis:"
echo "================="
echo "✅ Check if M2M token was obtained successfully"
echo "✅ Check if MCP gateway connection was established" 
echo "✅ Check if Lambda tool was invoked"
echo "✅ Check if Bedrock Knowledge Base was queried (if KNOWLEDGE_BASE_ID set)"
echo "✅ Check if results were returned to Broker Agent"

echo ""
echo "🔍 To debug further:"
echo "  - Check container logs: docker logs test-broker-agent-sdk-mcp"
echo "  - Check Lambda logs in CloudWatch: broker-agent-mcp-function"
echo "  - Check Gateway logs in AgentCore console"
echo "  - Ensure KNOWLEDGE_BASE_ID environment variable is set"
echo ""
echo "🧹 To clean up:"
echo "  docker stop test-broker-agent-sdk-mcp && docker rm test-broker-agent-sdk-mcp"
