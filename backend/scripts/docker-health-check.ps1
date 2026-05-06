# Docker Health Check and Verification Script
# Run this after starting services to verify everything is working

Write-Host "🔍 DigitalBookLLM Backend - Health Check" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$allHealthy = $true

# Check if Docker is running
Write-Host "1. Checking Docker..." -ForegroundColor Yellow
try {
    docker info > $null 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "   ✅ Docker is running" -ForegroundColor Green
    }
    else {
        Write-Host "   ❌ Docker is not running" -ForegroundColor Red
        $allHealthy = $false
    }
}
catch {
    Write-Host "   ❌ Docker is not available" -ForegroundColor Red
    $allHealthy = $false
}

Write-Host ""

# Check containers
Write-Host "2. Checking containers..." -ForegroundColor Yellow
$containers = docker-compose ps --services 2>$null
if ($containers) {
    foreach ($container in $containers) {
        $status = docker-compose ps $container 2>$null | Select-String "Up"
        if ($status) {
            Write-Host "   ✅ $container is running" -ForegroundColor Green
        }
        else {
            Write-Host "   ❌ $container is not running" -ForegroundColor Red
            $allHealthy = $false
        }
    }
}
else {
    Write-Host "   ⚠️  No containers found. Have you run 'docker-compose up'?" -ForegroundColor Yellow
    $allHealthy = $false
}

Write-Host ""

# Check PostgreSQL
Write-Host "3. Checking PostgreSQL..." -ForegroundColor Yellow
try {
    $pgCheck = docker-compose exec -T postgres pg_isready -U postgres 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "   ✅ PostgreSQL is ready" -ForegroundColor Green
        
        # Check pgvector extension
        $vectorCheck = docker-compose exec -T postgres psql -U postgres -d digitalbookllm -tAc "SELECT extname FROM pg_extension WHERE extname='vector';" 2>$null
        if ($vectorCheck -match "vector") {
            Write-Host "   ✅ pgvector extension installed" -ForegroundColor Green
        }
        else {
            Write-Host "   ❌ pgvector extension not found" -ForegroundColor Red
            $allHealthy = $false
        }
    }
    else {
        Write-Host "   ❌ PostgreSQL is not ready" -ForegroundColor Red
        $allHealthy = $false
    }
}
catch {
    Write-Host "   ❌ Cannot connect to PostgreSQL" -ForegroundColor Red
    $allHealthy = $false
}

Write-Host ""

# Check Backend API
Write-Host "4. Checking Backend API..." -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "http://localhost:3001/health" -TimeoutSec 5 -UseBasicParsing
    if ($response.StatusCode -eq 200) {
        Write-Host "   ✅ Backend API is healthy" -ForegroundColor Green
        $data = $response.Content | ConvertFrom-Json
        Write-Host "   📊 Status: $($data.status)" -ForegroundColor Gray
        Write-Host "   🕐 Time: $($data.timestamp)" -ForegroundColor Gray
    }
    else {
        Write-Host "   ❌ Backend API returned status: $($response.StatusCode)" -ForegroundColor Red
        $allHealthy = $false
    }
}
catch {
    Write-Host "   ❌ Cannot connect to Backend API" -ForegroundColor Red
    Write-Host "   💡 Check logs: docker-compose logs backend" -ForegroundColor Yellow
    $allHealthy = $false
}

Write-Host ""

# Check environment variables
Write-Host "5. Checking configuration..." -ForegroundColor Yellow
if (Test-Path ".env") {
    Write-Host "   ✅ .env file exists" -ForegroundColor Green
    
    $envContent = Get-Content ".env" -Raw
    if ($envContent -match "TOGETHER_API_KEY=\w+") {
        Write-Host "   ✅ TOGETHER_API_KEY is configured" -ForegroundColor Green
    }
    else {
        Write-Host "   ⚠️  TOGETHER_API_KEY not set (will use mock responses)" -ForegroundColor Yellow
    }
}
else {
    Write-Host "   ❌ .env file not found" -ForegroundColor Red
    $allHealthy = $false
}

Write-Host ""

# Check volumes
Write-Host "6. Checking volumes..." -ForegroundColor Yellow
$volumes = docker volume ls --filter name=backend_ --format "{{.Name}}"
if ($volumes) {
    foreach ($volume in $volumes) {
        Write-Host "   ✅ $volume" -ForegroundColor Green
    }
}
else {
    Write-Host "   ⚠️  No volumes found" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan

if ($allHealthy) {
    Write-Host "✅ All systems operational!" -ForegroundColor Green
    Write-Host ""
    Write-Host "🌐 You can now access:" -ForegroundColor Cyan
    Write-Host "   Backend API:  http://localhost:3001/api" -ForegroundColor White
    Write-Host "   Health Check: http://localhost:3001/health" -ForegroundColor White
    Write-Host "   PostgreSQL:   localhost:5433" -ForegroundColor White
    Write-Host ""
    Write-Host "📖 Next steps:" -ForegroundColor Cyan
    Write-Host "   - Upload a document: POST http://localhost:3001/api/documents/upload" -ForegroundColor White
    Write-Host "   - Query with RAG: POST http://localhost:3001/api/rag/query" -ForegroundColor White
    Write-Host "   - View logs: docker-compose logs -f" -ForegroundColor White
}
else {
    Write-Host "❌ Some checks failed!" -ForegroundColor Red
    Write-Host ""
    Write-Host "🔧 Troubleshooting:" -ForegroundColor Yellow
    Write-Host "   1. Check logs: docker-compose logs -f" -ForegroundColor White
    Write-Host "   2. Restart services: docker-compose restart" -ForegroundColor White
    Write-Host "   3. Rebuild: docker-compose up -d --build" -ForegroundColor White
    Write-Host "   4. See DOCKER_GUIDE.md for more help" -ForegroundColor White
}

Write-Host ""
