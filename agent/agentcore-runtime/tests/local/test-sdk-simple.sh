#!/bin/bash

# Simple Broker Agent SDK test with AWS credentials
echo "🧪 Simple Broker Agent SDK test with AWS credentials..."

# Get current AWS credentials
AWS_ACCESS_KEY_ID=$(aws configure get aws_access_key_id)
AWS_SECRET_ACCESS_KEY=$(aws configure get aws_secret_access_key)
AWS_SESSION_TOKEN=$(aws configure get aws_session_token)
AWS_DEFAULT_REGION=$(aws configure get region || echo "ap-southeast-2")

# Check if we have credentials
if [ -z "$AWS_ACCESS_KEY_ID" ]; then
    echo "❌ No AWS credentials found. Please run 'aws configure' first."
    exit 1
fi

echo "✅ Found AWS credentials for account: $(aws sts get-caller-identity --query Account --output text)"

# Stop any existing container
docker stop test-broker-agent-sdk-simple 2>/dev/null || true
docker rm test-broker-agent-sdk-simple 2>/dev/null || true

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

# Run container with AWS credentials
echo "🚀 Starting Broker Agent SDK with AWS credentials..."
docker run -d \
  --name test-broker-agent-sdk-simple \
  -p 8081:8080 \
  -e AWS_ACCESS_KEY_ID="$AWS_ACCESS_KEY_ID" \
  -e AWS_SECRET_ACCESS_KEY="$AWS_SECRET_ACCESS_KEY" \
  -e AWS_SESSION_TOKEN="$AWS_SESSION_TOKEN" \
  -e AWS_DEFAULT_REGION="$AWS_DEFAULT_REGION" \
  broker-agent-sdk:latest

# Wait for startup
echo "⏳ Waiting for Broker Agent to start..."
sleep 8

# Check if container is running
if ! docker ps | grep -q test-broker-agent-sdk-simple; then
    echo "❌ Container failed to start. Checking logs..."
    docker logs test-broker-agent-sdk-simple
    exit 1
fi

# Test ping endpoint first
echo "🏓 Testing ping endpoint..."
ping_response=$(curl -s http://localhost:8081/ping)
if [[ $ping_response == *"healthy"* ]]; then
    echo "✅ Ping successful: $ping_response"
else
    echo "❌ Ping failed: $ping_response"
    echo "📋 Container logs:"
    docker logs test-broker-agent-sdk-simple | tail -20
    exit 1
fi

# Test simple prompt that should work with local tools
echo ""
echo "🧪 Testing with simple time request:"
echo "================================"

# Create a simple test payload for Broker Agent SDK (BedrockAgentCoreApp format)
cat > /tmp/test_broker_sdk_time_request.json << 'EOF'
{
  "prompt": "What is the current time?",
  "session_id": "test-time-123",
  "actor_id": "user"
}
EOF

echo "Request payload:"
cat /tmp/test_broker_sdk_time_request.json
echo ""

# Broker Agent SDK uses /invocations endpoint
echo "Response:"
response=$(curl -s -X POST http://localhost:8081/invocations \
  -H "Content-Type: application/json" \
  -d @/tmp/test_broker_sdk_time_request.json)

echo "$response"

echo ""
echo ""
echo "🧪 Testing with basic tool usage:"
echo "================================"

cat > /tmp/test_broker_sdk_tool_request.json << 'EOF'
{
  "prompt": "Please use the get_current_time tool to show me the time, then echo back the message 'Broker Agent SDK is working!'",
  "session_id": "test-tool-123",
  "actor_id": "user"  
}
EOF

echo "Request payload:"
cat /tmp/test_broker_sdk_tool_request.json
echo ""

echo "Response:"
response=$(curl -s -X POST http://localhost:8081/invocations \
  -H "Content-Type: application/json" \
  -d @/tmp/test_broker_sdk_tool_request.json)

echo "$response"

echo ""
echo ""
echo "🧪 Testing broker-specific prompt:"
echo "================================"

cat > /tmp/test_broker_sdk_context_request.json << 'EOF'
{
  "prompt": "I am a mortgage broker and I need help with lending policies. Can you tell me what you can help me with?",
  "session_id": "test-broker-context-123",
  "actor_id": "user"  
}
EOF

echo "Request payload:"
cat /tmp/test_broker_sdk_context_request.json
echo ""

echo "Response:"
response=$(curl -s -X POST http://localhost:8081/invocations \
  -H "Content-Type: application/json" \
  -d @/tmp/test_broker_sdk_context_request.json)

echo "$response"

echo ""
echo ""
echo "📋 Container startup logs:"
echo "================================"
docker logs test-broker-agent-sdk-simple | head -30

echo ""
echo "📋 Recent container logs:"
echo "================================"
docker logs test-broker-agent-sdk-simple | tail -20

echo ""
echo "🎉 Simple Broker Agent testing complete!"
echo "========================================"
echo "Broker Agent SDK container details:"
echo "  Container: test-broker-agent-sdk-simple"
echo "  Port: 8081"
echo "  Endpoint: http://localhost:8081"
echo ""
echo "To view full container logs:"
echo "  docker logs test-broker-agent-sdk-simple"
echo ""
echo "To stop the test container:"
echo "  docker stop test-broker-agent-sdk-simple && docker rm test-broker-agent-sdk-simple"
