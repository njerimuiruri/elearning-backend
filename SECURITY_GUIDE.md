# 🔒 Security Best Practices Guide

## ⚠️ CRITICAL: Protecting Your Credentials

This guide ensures your SMTP credentials, database passwords, and API keys are **NEVER** exposed when pushing to GitHub.

---

## ✅ What's Already Secure

Your backend is already following good security practices:

### 1. **.env File Protected**

```bash
# Your .gitignore includes:
.env
.env.*
.env.local
.env.production
```

✅ **Status**: Your `.env` file is NOT tracked by Git  
✅ **Verified**: Running `git ls-files | Select-String ".env"` shows only `.env.example` and `.env.template`  
✅ **Safe**: No `.env` commits found in Git history

### 2. **Environment Variables Used Properly**

All sensitive data is loaded via `process.env`:

- ✅ Database: `MONGODB_URI`
- ✅ JWT: `JWT_SECRET`
- ✅ SMTP: `SMTP_USER`, `SMTP_PASS`, `SMTP_HOST`
- ✅ Cloudinary: `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`
- ✅ Frontend URL: `FRONTEND_URL`

### 3. **Render Configuration Secure**

Your `render.yaml` uses `sync: false` for all secrets:

```yaml
- key: SMTP_PASS
  sync: false # Must be set manually in Render Dashboard
```

---

## 🛡️ Security Checklist

### Before Every Git Push:

#### 1. **Verify .env is Not Staged**

```powershell
git status
```

**Check**: `.env` should NOT appear in the output  
**If it appears**: Remove it immediately:

```powershell
git reset .env
git rm --cached .env -f
```

#### 2. **Check Git History**

```powershell
git log --all --full-history -- .env
```

**Should return**: No output (empty)  
**If commits exist**: You need to clean Git history (see below)

#### 3. **Search for Hardcoded Credentials**

```powershell
# Search for potential secrets in code
git grep -i "password"
git grep -i "smtp"
git grep -i "mongodb://"
git grep -i "api_key"
```

**Should find**: Only references to `process.env.VARIABLE_NAME`  
**Should NOT find**: Actual passwords or API keys

#### 4. **Review Files Being Committed**

```powershell
git diff --cached
```

Look for:

- ❌ Actual passwords or API keys
- ❌ MongoDB connection strings with credentials
- ❌ JWT secrets
- ❌ Email passwords

---

## 🚨 Emergency: If You Accidentally Committed Secrets

### Option 1: Remove from Last Commit (Before Push)

```powershell
# Remove .env from last commit
git reset HEAD~1
git add . -A
git reset .env
git commit -m "Your commit message"
```

### Option 2: Remove from Git History (After Push)

```powershell
# Remove .env from entire Git history
git filter-branch --force --index-filter "git rm --cached --ignore-unmatch .env" --prune-empty --tag-name-filter cat -- --all

# Force push (WARNING: This rewrites history)
git push origin --force --all
```

### Option 3: Use BFG Repo-Cleaner (Recommended for large repos)

```powershell
# Install BFG (requires Java)
# Download from: https://rtyley.github.io/bfg-repo-cleaner/

# Remove .env file from history
java -jar bfg.jar --delete-files .env

# Clean up
git reflog expire --expire=now --all
git gc --prune=now --aggressive

# Force push
git push origin --force --all
```

### Option 4: Rotate All Compromised Credentials

If secrets were pushed to GitHub:

1. **MongoDB**: Change password in MongoDB Atlas
2. **JWT Secret**: Generate new one:
   ```powershell
   node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
   ```
3. **SMTP Password**: Generate new Gmail App Password
4. **Cloudinary**: Rotate API keys in Cloudinary dashboard
5. **Update all services** with new credentials

---

## 🔐 How to Generate Secure Credentials

### JWT Secret (Strong Random String)

```powershell
# PowerShell
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"

# Output example:
# a7f3d8e2b9c4a1f6e8d3b7a9c2f5e8d1b4a7f3e9c6d2a8f4b1e7d3a9c5f8e2b6
```

### Strong Passwords

```powershell
# Generate 32-character password
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

### Gmail App Password

1. Go to: https://myaccount.google.com/apppasswords
2. Enable 2-Factor Authentication first
3. Generate app password for "Mail"
4. Use this instead of your Gmail password

---

## 📋 Safe Deployment Workflow

### 1. Development (.env file)

```dotenv
# Local .env file (NEVER commit!)
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/elearning
JWT_SECRET=super_secret_key_xyz123
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
```

### 2. GitHub Repository

```bash
# Only these files should be in Git:
✅ .env.example (template with dummy values)
✅ .env.template (template with dummy values)
✅ render.yaml (with sync: false for secrets)
✅ .gitignore (excludes .env)

❌ .env (NEVER!)
❌ Any file with real credentials
```

### 3. Render Platform (Production)

Set environment variables in Render Dashboard:

- Go to: Dashboard → Your Service → Environment
- Click "Add Environment Variable"
- Add each secret manually:
  ```
  MONGODB_URI=your_production_mongodb_uri
  JWT_SECRET=your_production_jwt_secret
  SMTP_PASS=your_production_smtp_password
  ```

---

## 🧪 Pre-Push Security Scan

Run this script before every push:

```powershell
# Create: security-check.ps1

Write-Host "🔍 Running Security Scan..." -ForegroundColor Yellow

# Check if .env is staged
$envStaged = git diff --cached --name-only | Select-String ".env$"
if ($envStaged) {
    Write-Host "❌ ERROR: .env file is staged!" -ForegroundColor Red
    Write-Host "Run: git reset .env" -ForegroundColor Yellow
    exit 1
}

# Check for potential secrets in staged files
$secrets = git diff --cached | Select-String -Pattern "(password|secret|api_key|mongodb\+srv)" -CaseSensitive:$false
if ($secrets) {
    Write-Host "⚠️  WARNING: Potential secrets found in staged files!" -ForegroundColor Red
    $secrets | ForEach-Object { Write-Host $_.Line -ForegroundColor Yellow }
    exit 1
}

# Check .gitignore exists
if (!(Test-Path ".gitignore")) {
    Write-Host "❌ ERROR: .gitignore not found!" -ForegroundColor Red
    exit 1
}

# Verify .env is in .gitignore
$gitignoreContent = Get-Content ".gitignore" -Raw
if ($gitignoreContent -notmatch "\.env") {
    Write-Host "❌ ERROR: .env not in .gitignore!" -ForegroundColor Red
    exit 1
}

Write-Host "✅ Security scan passed!" -ForegroundColor Green
Write-Host "Safe to push to GitHub" -ForegroundColor Green
```

### Usage:

```powershell
# Before git push, run:
.\security-check.ps1

# If passed, push:
git push origin main
```

---

## 🎯 Production Deployment Security

### Render Platform Security:

1. **Never Hardcode Secrets in Code**

   ```typescript
   // ❌ WRONG
   const password = 'mypassword123';

   // ✅ CORRECT
   const password = process.env.SMTP_PASS;
   ```

2. **Use Environment Variables**
   - Set in Render Dashboard → Environment
   - Never in `render.yaml` file
   - Use `sync: false` for secrets

3. **Enable Render Secret Scanning**
   - Render automatically scans for exposed secrets
   - Fix any alerts immediately

### Vercel Platform Security:

1. **Set Environment Variables in Vercel**

   ```
   Dashboard → Project → Settings → Environment Variables

   Add:
   NEXT_PUBLIC_API_URL=https://your-backend.onrender.com
   ```

2. **Never Commit Vercel Secrets**
   ```bash
   # .gitignore should include:
   .vercel
   .env.local
   .env*.local
   ```

---

## 🔍 Audit Your Codebase

### Regular Security Checks:

```powershell
# 1. Check for exposed secrets
git secrets --scan

# 2. Search for potential leaks
git grep -E "(password|secret|api_key).*=.*['\"][^'\"]{8,}"

# 3. Verify .gitignore
cat .gitignore | Select-String "env"

# 4. List tracked files
git ls-files | Select-String "env"

# 5. Check Git history for secrets
git log --all --full-history --source -- .env
```

---

## 📚 Additional Security Measures

### 1. **Enable GitHub Secret Scanning**

- Go to: Repository → Settings → Security → Secret scanning
- Enable for private repositories

### 2. **Use Git Hooks**

Create `.git/hooks/pre-commit`:

```bash
#!/bin/sh

# Check for .env file
if git diff --cached --name-only | grep -q "^\.env$"; then
    echo "ERROR: Attempting to commit .env file!"
    exit 1
fi

# Check for potential secrets
if git diff --cached | grep -iE "(password|secret|api_key).*="; then
    echo "WARNING: Potential secret detected!"
    exit 1
fi

exit 0
```

### 3. **Use Environment-Specific Files**

```bash
.env.development  # Local development
.env.staging      # Staging environment
.env.production   # Production (NEVER commit)
```

### 4. **Rotate Secrets Regularly**

- Change JWT_SECRET every 90 days
- Rotate API keys quarterly
- Update passwords after team changes

---

## ✅ Your Current Security Status

Based on the scan:

- ✅ `.env` file is in `.gitignore`
- ✅ No `.env` commits in Git history
- ✅ All secrets use `process.env`
- ✅ `render.yaml` uses `sync: false`
- ✅ `.env.example` has safe template values
- ✅ No hardcoded credentials in code

**Status**: **🟢 SECURE**

---

## 📞 Security Incident Response

If credentials are exposed:

### Immediate Actions (Within 1 Hour):

1. ✅ Rotate all exposed credentials
2. ✅ Remove secrets from Git history
3. ✅ Force push cleaned repository
4. ✅ Notify team members

### Short-Term (Within 24 Hours):

1. ✅ Review access logs for unauthorized use
2. ✅ Update all connected services
3. ✅ Document incident
4. ✅ Implement additional safeguards

### Long-Term:

1. ✅ Set up secret scanning tools
2. ✅ Train team on security practices
3. ✅ Regular security audits
4. ✅ Automated security checks in CI/CD

---

## 🎓 Security Resources

- [GitHub Secret Scanning](https://docs.github.com/en/code-security/secret-scanning)
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Git-secrets Tool](https://github.com/awslabs/git-secrets)
- [BFG Repo-Cleaner](https://rtyley.github.io/bfg-repo-cleaner/)
- [Render Environment Variables](https://render.com/docs/environment-variables)

---

## 🚀 Quick Reference Commands

```powershell
# Check what's staged
git status

# Verify .env is not tracked
git ls-files | Select-String ".env"

# Remove .env if accidentally staged
git reset .env
git rm --cached .env -f

# Search for secrets in code
git grep -i "password"
git grep -i "api_key"

# Generate strong secret
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"

# Check Git history
git log --all --full-history -- .env
```

---

## ✅ Final Security Checklist

Before pushing to GitHub:

- [ ] `.env` is in `.gitignore`
- [ ] No `.env` in `git status`
- [ ] No credentials in code (only `process.env`)
- [ ] `.env.example` has dummy values only
- [ ] `render.yaml` uses `sync: false` for secrets
- [ ] Ran security scan script
- [ ] No secrets in commit diff
- [ ] Strong passwords generated
- [ ] Two-factor authentication enabled on GitHub

---

**Remember**: It's easier to prevent credential exposure than to clean it up afterward!

🔒 **Stay Secure!**
