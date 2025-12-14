# 🚀 Quick Deployment Checklist

## Before Pushing to GitHub

### 1. Run Security Scan

```powershell
.\security-check.ps1
```

### 2. Verify No Secrets

```powershell
# Check staged files
git status

# Should NOT see .env file listed
```

### 3. Check Files Being Committed

```powershell
git diff --cached
```

Look for:

- ❌ Passwords
- ❌ API keys
- ❌ MongoDB connection strings with credentials
- ❌ JWT secrets

---

## Deployment to Render (Backend)

### Step 1: Push to GitHub

```powershell
git add .
git commit -m "Your commit message"
git push origin main
```

### Step 2: Deploy on Render

1. Go to https://dashboard.render.com
2. Click "New +" → "Web Service"
3. Connect your GitHub repository
4. Configuration:
   - **Name**: elearning-backend
   - **Branch**: main
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm run start:prod`

### Step 3: Add Environment Variables

In Render Dashboard → Environment:

```
NODE_ENV=production
PORT=5000
MONGODB_URI=your_mongodb_atlas_uri
JWT_SECRET=your_generated_jwt_secret
JWT_EXPIRES_IN=7d
FRONTEND_URL=https://your-vercel-app.vercel.app
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-gmail-app-password
SMTP_FROM_EMAIL=your-email@gmail.com
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret
```

### Step 4: Get Backend URL

After deployment, copy your backend URL:

```
https://your-app-name.onrender.com
```

---

## Deployment to Vercel (Frontend)

### Step 1: Push Frontend to GitHub

```powershell
cd elearning
git add .
git commit -m "Frontend deployment"
git push origin main
```

### Step 2: Deploy on Vercel

1. Go to https://vercel.com
2. Click "Add New" → "Project"
3. Import your GitHub repository
4. Add Environment Variable:
   ```
   NEXT_PUBLIC_API_URL=https://your-backend.onrender.com
   ```
5. Click "Deploy"

### Step 3: Update Backend CORS

In Render, update `FRONTEND_URL`:

```
FRONTEND_URL=https://your-frontend.vercel.app
```

---

## Post-Deployment

### 1. Test Swagger Docs

```
https://your-backend.onrender.com/docs
```

### 2. Test Frontend

```
https://your-frontend.vercel.app
```

### 3. Test Full Flow

- ✅ Register account
- ✅ Login
- ✅ Create course (instructor)
- ✅ Enroll in course (student)
- ✅ Complete course
- ✅ Download certificate

---

## Security Reminders

- [ ] `.env` file is in `.gitignore`
- [ ] No `.env` in Git history
- [ ] All secrets use `process.env`
- [ ] Ran `.\security-check.ps1` before push
- [ ] Environment variables set in Render Dashboard
- [ ] Strong JWT secret generated
- [ ] Gmail App Password (not account password)
- [ ] Two-factor authentication enabled on GitHub
- [ ] MongoDB Atlas whitelist configured (0.0.0.0/0)

---

## Quick Commands

```powershell
# Generate JWT Secret
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"

# Check Git status
git status

# Run security scan
.\security-check.ps1

# Check for .env in Git
git ls-files | Select-String ".env"

# View staged changes
git diff --cached

# Remove .env if accidentally staged
git reset .env
git rm --cached .env -f
```

---

## Support

- 📖 Full Guide: `SECURITY_GUIDE.md`
- 🚀 Deployment: `DEPLOYMENT_GUIDE.md`
- 🔧 Security Scanner: `security-check.ps1`

**Remember**: Never commit `.env` file! Always use environment variables in production.

🔒 **Stay Secure!** 🚀
