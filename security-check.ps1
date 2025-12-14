# 🔍 Pre-Push Security Scanner
# Run this before every git push to ensure no secrets are exposed

Write-Host "`n🔒 Running Security Scan..." -ForegroundColor Cyan
Write-Host "=" * 60 -ForegroundColor Gray

$errors = 0
$warnings = 0

# Check 1: Is .env file staged?
Write-Host "`n[1/6] Checking for staged .env files..." -ForegroundColor Yellow
$envStaged = git diff --cached --name-only | Select-String -Pattern "\.env$" -SimpleMatch
if ($envStaged) {
    Write-Host "❌ ERROR: .env file is staged for commit!" -ForegroundColor Red
    Write-Host "   Run: git reset .env" -ForegroundColor Yellow
    $errors++
}
else {
    Write-Host "✅ No .env files staged" -ForegroundColor Green
}

# Check 2: Is .env in Git history?
Write-Host "`n[2/6] Checking Git history for .env..." -ForegroundColor Yellow
$envHistory = git log --all --full-history --source -- .env 2>$null
if ($envHistory) {
    Write-Host "❌ ERROR: .env found in Git history!" -ForegroundColor Red
    Write-Host "   This is a security risk. See SECURITY_GUIDE.md for cleanup." -ForegroundColor Yellow
    $errors++
}
else {
    Write-Host "✅ No .env in Git history" -ForegroundColor Green
}

# Check 3: Search for potential hardcoded secrets
Write-Host "`n[3/6] Scanning staged files for potential secrets..." -ForegroundColor Yellow
$stagedDiff = git diff --cached 2>$null

if ($stagedDiff) {
    # Check for patterns that might be secrets
    $secretPatterns = @(
        "password\s*=\s*['\"][^'\"]{4,}['\"]",
        "secret\s*=\s*['\"][^'\"]{4,}['\"]",
        "api_key\s*=\s*['\"][^'\"]{4,}['\"]",
        "mongodb\+srv://[^'\"]+:[^'\"]+@",
        "smtp_pass\s*=\s*['\"][^'\"]{ 4, }['\"]",
        "Bearer\s+[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+"
    )
    
    $foundSecrets = $false
    foreach ($pattern in $secretPatterns) {
        $matches = $stagedDiff | Select-String -Pattern $pattern -CaseSensitive:$false
        if ($matches) {
            if (-not $foundSecrets) {
                Write-Host "⚠️  WARNING: Potential secrets detected in staged files:" -ForegroundColor Red
                $foundSecrets = $true
                $warnings++
            }
            $matches | ForEach-Object {
                Write-Host "   Line: $($_.Line.Trim())" -ForegroundColor Yellow
            }
        }
    }
    
    if (-not $foundSecrets) {
        Write-Host "✅ No obvious secrets detected" -ForegroundColor Green
    }
} else {
    Write-Host "✅ No staged changes to scan" -ForegroundColor Green
}

# Check 4: Verify .gitignore exists and contains .env
Write-Host "`n[4/6] Verifying .gitignore configuration..." -ForegroundColor Yellow
if (Test-Path ".gitignore") {
    $gitignoreContent = Get-Content ".gitignore" -Raw
    if ($gitignoreContent -match "\.env") {
        Write-Host "✅ .gitignore properly configured" -ForegroundColor Green
    } else {
        Write-Host "❌ ERROR: .env not found in .gitignore!" -ForegroundColor Red
        $errors++
    }
} else {
    Write-Host "❌ ERROR: .gitignore file not found!" -ForegroundColor Red
    $errors++
}

# Check 5: Verify .env file is not tracked
Write-Host "`n[5/6] Checking if .env is tracked by Git..." -ForegroundColor Yellow
$trackedEnv = git ls-files | Select-String -Pattern "^\.env$"
if ($trackedEnv) {
    Write-Host "❌ ERROR: .env file is tracked by Git!" -ForegroundColor Red
    Write-Host "   Run: git rm --cached .env -f" -ForegroundColor Yellow
    $errors++
} else {
    Write-Host "✅ .env is not tracked" -ForegroundColor Green
}

# Check 6: Look for environment variable usage in code
Write-Host "`n[6/6] Verifying proper environment variable usage..." -ForegroundColor Yellow
$hardcodedSecrets = git diff --cached | Select-String -Pattern "(MONGODB_URI|JWT_SECRET|SMTP_PASS|API_KEY)\s*=\s*['\"](?!process\.env)" -CaseSensitive:$false
        if ($hardcodedSecrets) {
            Write-Host "⚠️  WARNING: Possible hardcoded credentials detected:" -ForegroundColor Red
            $hardcodedSecrets | ForEach-Object {
                Write-Host "   $($_.Line.Trim())" -ForegroundColor Yellow
            }
            $warnings++
        }
        else {
            Write-Host "✅ Environment variables used correctly" -ForegroundColor Green
        }

        # Summary
        Write-Host "`n" + ("=" * 60) -ForegroundColor Gray
        Write-Host "`n📊 Security Scan Summary:" -ForegroundColor Cyan
        Write-Host "   Errors: $errors" -ForegroundColor $(if ($errors -eq 0) { "Green" } else { "Red" })
        Write-Host "   Warnings: $warnings" -ForegroundColor $(if ($warnings -eq 0) { "Green" } else { "Yellow" })

        if ($errors -gt 0) {
            Write-Host "`n❌ SECURITY SCAN FAILED!" -ForegroundColor Red
            Write-Host "   Fix the errors above before pushing to GitHub." -ForegroundColor Yellow
            Write-Host "   See SECURITY_GUIDE.md for detailed instructions.`n" -ForegroundColor Yellow
            exit 1
        }
        elseif ($warnings -gt 0) {
            Write-Host "`n⚠️  SECURITY SCAN PASSED WITH WARNINGS" -ForegroundColor Yellow
            Write-Host "   Review the warnings above carefully." -ForegroundColor Yellow
            Write-Host "   Press any key to continue or Ctrl+C to cancel...`n" -ForegroundColor Yellow
            $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
        }
        else {
            Write-Host "`n✅ SECURITY SCAN PASSED!" -ForegroundColor Green
            Write-Host "   Safe to push to GitHub 🚀`n" -ForegroundColor Green
        }

        exit 0
