# Docker Quick Start Script for DigitalBookLLM Backend
# Run this script to quickly start the backend with Docker

Write-Host "🐳 DigitalBookLLM Backend - Docker Setup" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host ""

# Check if Docker is running
Write-Host "Checking Docker..." -ForegroundColor Yellow
try {
    docker --version | Out-Null
    docker-compose --version | Out-Null
    Write-Host "✅ Docker is installed" -ForegroundColor Green
}
catch {
    Write-Host "❌ Docker is not installed or not running" -ForegroundColor Red
    Write-Host "Please install Docker Desktop from https://www.docker.com/products/docker-desktop" -ForegroundColor Yellow
    exit 1
}

# Check if .env exists
if (-not (Test-Path ".env")) {
    Write-Host ""
    Write-Host "⚠️  .env file not found" -ForegroundColor Yellow
    Write-Host "Creating .env from .env.example..." -ForegroundColor Yellow
    
    if (Test-Path ".env.example") {
        Copy-Item ".env.example" ".env"
        Write-Host "✅ Created .env file" -ForegroundColor Green
        Write-Host ""
        Write-Host "⚠️  IMPORTANT: Edit .env and add your TOGETHER_API_KEY" -ForegroundColor Yellow
        Write-Host "   You can get one from: https://api.together.xyz/" -ForegroundColor Cyan
        Write-Host ""
        
        $response = Read-Host "Do you want to edit .env now? (y/n)"
        if ($response -eq "y" -or $response -eq "Y") {
            notepad .env
        }
    }
    else {
        Write-Host "❌ .env.example not found" -ForegroundColor Red
        exit 1
    }
}

Write-Host ""
Write-Host "Select deployment mode:" -ForegroundColor Cyan
Write-Host "1. Production (optimized, ready for deployment)" -ForegroundColor White
Write-Host "2. Development (hot reload, debug mode)" -ForegroundColor White
Write-Host ""

$mode = Read-Host "Enter choice (1 or 2)"

Write-Host ""

if ($mode -eq "2") {
    Write-Host "🚀 Starting in DEVELOPMENT mode..." -ForegroundColor Yellow
    Write-Host "   - Hot reload enabled" -ForegroundColor Gray
    Write-Host "   - Source code mounted" -ForegroundColor Gray
    Write-Host "   - Running with nodemon" -ForegroundColor Gray
    Write-Host ""
    docker-compose up
}
else {
    Write-Host "🚀 Starting in PRODUCTION mode..." -ForegroundColor Green
    Write-Host "   - Optimized build" -ForegroundColor Gray
    Write-Host "   - Multi-stage Docker image" -ForegroundColor Gray
    Write-Host "   - Running in background" -ForegroundColor Gray
    Write-Host ""
    
    docker-compose -f docker-compose.yml up -d --build
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host ""
        Write-Host "✅ Backend started successfully!" -ForegroundColor Green
        Write-Host ""
        Write-Host "📍 Services:" -ForegroundColor Cyan
        Write-Host "   Backend API:  http://localhost:3001" -ForegroundColor White
        Write-Host "   PostgreSQL:   localhost:5433" -ForegroundColor White
        Write-Host "   Health Check: http://localhost:3001/health" -ForegroundColor White
        Write-Host ""
        Write-Host "📊 View logs:" -ForegroundColor Cyan
        Write-Host "   docker-compose logs -f" -ForegroundColor White
        Write-Host ""
        Write-Host "🛑 Stop services:" -ForegroundColor Cyan
        Write-Host "   docker-compose down" -ForegroundColor White
        Write-Host ""
        
        # Wait a moment for services to start
        Start-Sleep -Seconds 5
        
        # Check health
        try {
            $response = Invoke-WebRequest -Uri "http://localhost:3001/health" -TimeoutSec 5
            if ($response.StatusCode -eq 200) {
                Write-Host "✅ Health check passed!" -ForegroundColor Green
            }
        }
        catch {
            Write-Host "⚠️  Services starting... check logs with: docker-compose logs -f" -ForegroundColor Yellow
        }
    }
    else {
        Write-Host ""
        Write-Host "❌ Failed to start services" -ForegroundColor Red
        Write-Host "Check logs with: docker-compose logs" -ForegroundColor Yellow
    }
}
