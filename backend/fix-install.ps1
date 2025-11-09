# Fix npm install issues for DigitalBookLLM Backend
# This script helps resolve common installation problems on Windows

Write-Host ""
Write-Host "Fix Script for DigitalBookLLM Backend - Installation" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

# Check if Node.js is installed
Write-Host ""
Write-Host "Checking Node.js installation..." -ForegroundColor Yellow
$nodeVersion = node --version 2>$null
if ($LASTEXITCODE -eq 0) {
    Write-Host "Node.js version: $nodeVersion" -ForegroundColor Green
}
else {
    Write-Host "Node.js is not installed. Please install Node.js 18+ from https://nodejs.org/" -ForegroundColor Red
    exit 1
}

# Check npm version
$npmVersion = npm --version 2>$null
Write-Host "npm version: $npmVersion" -ForegroundColor Green

# Clean existing installation
Write-Host ""
Write-Host "Cleaning existing installation..." -ForegroundColor Yellow
if (Test-Path "node_modules") {
    Write-Host "   Removing node_modules directory..." -ForegroundColor Gray
    Remove-Item -Recurse -Force "node_modules" -ErrorAction SilentlyContinue
}
if (Test-Path "package-lock.json") {
    Write-Host "   Removing package-lock.json..." -ForegroundColor Gray
    Remove-Item -Force "package-lock.json" -ErrorAction SilentlyContinue
}

# Clear npm cache
Write-Host ""
Write-Host "Clearing npm cache..." -ForegroundColor Yellow
npm cache clean --force

# Install with better error handling
Write-Host ""
Write-Host "Installing dependencies (this may take a few minutes)..." -ForegroundColor Yellow
Write-Host "   Using --legacy-peer-deps to avoid conflicts..." -ForegroundColor Gray

$env:NODE_OPTIONS = "--max-old-space-size=4096"
npm install --legacy-peer-deps --loglevel=error

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "Installation completed successfully!" -ForegroundColor Green
    
    # Verify critical packages
    Write-Host ""
    Write-Host "Verifying critical packages..." -ForegroundColor Yellow
    $criticalPackages = @("express", "pg", "typescript", "@types/node", "dotenv", "multer")
    $allFound = $true
    
    foreach ($pkg in $criticalPackages) {
        if (Test-Path "node_modules/$pkg") {
            Write-Host "   $pkg - OK" -ForegroundColor Green
        }
        else {
            Write-Host "   $pkg - MISSING" -ForegroundColor Red
            $allFound = $false
        }
    }
    
    if ($allFound) {
        Write-Host ""
        Write-Host "All critical packages installed successfully!" -ForegroundColor Green
        Write-Host ""
        Write-Host "Next steps:" -ForegroundColor Cyan
        Write-Host "   1. Copy .env.example to .env and configure your settings" -ForegroundColor White
        Write-Host "   2. Make sure PostgreSQL is running" -ForegroundColor White
        Write-Host "   3. Run: npm run migrate (to create database tables)" -ForegroundColor White
        Write-Host "   4. Run: npm run dev (to start the development server)" -ForegroundColor White
    }
    else {
        Write-Host ""
        Write-Host "Some packages are missing. Try running: npm install again" -ForegroundColor Yellow
    }
}
else {
    Write-Host ""
    Write-Host "Installation failed. Trying alternative approach..." -ForegroundColor Red
    Write-Host "   Installing packages in smaller groups..." -ForegroundColor Gray
    
    # Install in groups
    npm install express cors dotenv helmet morgan --legacy-peer-deps
    npm install pg pgvector --legacy-peer-deps
    npm install multer pdf-parse mammoth --legacy-peer-deps
    npm install axios uuid express-rate-limit --legacy-peer-deps
    npm install "@xenova/transformers" --legacy-peer-deps
    npm install -D typescript "@types/node" "@types/express" "@types/cors" "@types/multer" "@types/pg" "@types/uuid" "@types/morgan" ts-node nodemon --legacy-peer-deps
    
    Write-Host ""
    Write-Host "Packages installed in groups. Please verify manually." -ForegroundColor Yellow
}

Write-Host ""
