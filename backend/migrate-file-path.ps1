# Quick Migration Script for file_path column
# Run this if you have existing PDFs that won't load

Write-Host "`nAdding file_path column to documents table..." -ForegroundColor Cyan

# Try to read .env for database credentials
$envFile = ".env"
$dbHost = "localhost"
$dbPort = "5432"
$dbUser = "postgres"
$dbName = "digitalbookllm"

if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        if ($_ -match "^DB_HOST=(.+)$") { $dbHost = $matches[1] }
        if ($_ -match "^DB_PORT=(.+)$") { $dbPort = $matches[1] }
        if ($_ -match "^DB_USER=(.+)$") { $dbUser = $matches[1] }
        if ($_ -match "^DB_NAME=(.+)$") { $dbName = $matches[1] }
    }
}

Write-Host "Database: $dbName@$dbHost:$dbPort as $dbUser" -ForegroundColor Gray

# Run the migration
$migrationFile = "src\db\add_file_path.sql"

if (Test-Path $migrationFile) {
    Write-Host "`nRunning migration..." -ForegroundColor Yellow
    
    # Use psql to run the migration
    $env:PGPASSWORD = Read-Host -Prompt "Enter PostgreSQL password" -AsSecureString
    $BSTR = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($env:PGPASSWORD)
    $env:PGPASSWORD = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($BSTR)
    
    psql -h $dbHost -p $dbPort -U $dbUser -d $dbName -f $migrationFile
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "`n✅ Migration completed successfully!" -ForegroundColor Green
        Write-Host "`nIMPORTANT: Existing PDFs need to be re-uploaded!" -ForegroundColor Yellow
        Write-Host "The file_path column has been added, but old documents don't have file paths." -ForegroundColor Yellow
        Write-Host "Please delete and re-upload any existing PDF documents." -ForegroundColor Yellow
    } else {
        Write-Host "`n❌ Migration failed. Check the error above." -ForegroundColor Red
    }
} else {
    Write-Host "`n❌ Migration file not found: $migrationFile" -ForegroundColor Red
}

Write-Host ""
