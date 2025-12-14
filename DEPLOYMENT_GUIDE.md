# E-Learning Platform Deployment Guide

## 🚀 Deployment Overview

- **Backend**: Render (Node.js)
- **Frontend**: Vercel (Next.js)
- **Database**: MongoDB Atlas (already configured)

---

## 📦 Backend Deployment on Render

### Prerequisites

- GitHub account
- Render account (sign up at https://render.com)
- MongoDB Atlas connection string

### Step 1: Prepare Backend for Deployment

1. **Update CORS in `src/main.ts`**:

   ```typescript
   app.enableCors({
     origin: [
       'http://localhost:3000',
       'https://your-frontend-url.vercel.app', // Add your Vercel URL
     ],
     credentials: true,
   });
   ```

2. **Ensure `.gitignore` excludes sensitive files**:
   ```
   node_modules/
   dist/
   .env
   uploads/
   ```

### Step 2: Push to GitHub

```bash
cd elearning-backend
git init
git add .
git commit -m "Initial commit - Backend deployment"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/elearning-backend.git
git push -u origin main
```

### Step 3: Deploy on Render

1. **Go to Render Dashboard**: https://dashboard.render.com

2. **Click "New +" → "Web Service"**

3. **Connect GitHub Repository**:
   - Authorize Render to access your GitHub
   - Select `elearning-backend` repository

4. **Configure Service**:
   - **Name**: `elearning-backend`
   - **Region**: Choose closest to you (e.g., Oregon)
   - **Branch**: `main`
   - **Root Directory**: Leave blank
   - **Runtime**: `Node`
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm run start:prod`
   - **Plan**: Free (or paid if you need)

5. **Add Environment Variables**:
   Click "Advanced" → "Add Environment Variable"

   Add these variables (copy from your `.env` file):

   ```
   NODE_ENV=production
   PORT=5000
   MONGODB_URI=your_mongodb_connection_string
   JWT_SECRET=your_jwt_secret
   JWT_EXPIRES_IN=7d
   FRONTEND_URL=https://your-vercel-url.vercel.app
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=587
   SMTP_USER=your-email@gmail.com
   SMTP_PASS=your-app-password
   SMTP_FROM_EMAIL=your-email@gmail.com
   CLOUDINARY_CLOUD_NAME=your_cloud_name
   CLOUDINARY_API_KEY=your_api_key
   CLOUDINARY_API_SECRET=your_api_secret
   ```

6. **Click "Create Web Service"**

7. **Wait for Deployment** (5-10 minutes)

8. **Get Your Backend URL**:
   - Example: `https://elearning-backend.onrender.com`

9. **Test Swagger Documentation**:
   - Visit: `https://elearning-backend.onrender.com/docs`

---

## 🌐 Frontend Deployment on Vercel

### Step 1: Prepare Frontend for Deployment

1. **Create Environment Variable File**:

   Create `.env.local` in frontend:

   ```
   NEXT_PUBLIC_API_URL=https://your-backend-url.onrender.com
   ```

2. **Update API Calls to Use Environment Variable**:

   Example in your API service files:

   ```javascript
   const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

   axios.get(`${API_URL}/api/courses`);
   ```

3. **Check `.gitignore`**:
   ```
   node_modules/
   .next/
   .env.local
   .env*.local
   ```

### Step 2: Push Frontend to GitHub

```bash
cd elearning
git init
git add .
git commit -m "Initial commit - Frontend deployment"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/elearning-frontend.git
git push -u origin main
```

### Step 3: Deploy on Vercel

1. **Go to Vercel**: https://vercel.com

2. **Click "Add New" → "Project"**

3. **Import Git Repository**:
   - Connect GitHub if not already
   - Select `elearning-frontend` repository

4. **Configure Project**:
   - **Framework Preset**: Next.js (auto-detected)
   - **Root Directory**: `./`
   - **Build Command**: `npm run build` (auto-filled)
   - **Output Directory**: `.next` (auto-filled)

5. **Add Environment Variables**:

   ```
   NEXT_PUBLIC_API_URL=https://your-backend-url.onrender.com
   ```

6. **Click "Deploy"**

7. **Wait for Deployment** (2-5 minutes)

8. **Get Your Frontend URL**:
   - Example: `https://elearning-abc123.vercel.app`

### Step 4: Update Backend CORS

Go back to Render and update the `FRONTEND_URL` environment variable with your Vercel URL:

```
FRONTEND_URL=https://elearning-abc123.vercel.app
```

Then **manually redeploy** your backend on Render.

---

## 🔄 Post-Deployment Configuration

### 1. Update Frontend with Backend URL

In Vercel dashboard:

- Go to Settings → Environment Variables
- Update `NEXT_PUBLIC_API_URL` with your Render backend URL
- Redeploy

### 2. Update Backend CORS

In your backend code (`src/main.ts`), add your Vercel URL:

```typescript
app.enableCors({
  origin: [
    process.env.FRONTEND_URL,
    'https://your-actual-vercel-url.vercel.app',
  ],
  credentials: true,
});
```

Push to GitHub, Render will auto-deploy.

### 3. Test MongoDB Connection

Ensure your MongoDB Atlas allows connections from:

- Click "Network Access" in Atlas
- Add IP: `0.0.0.0/0` (allows all, or add Render's IPs)

---

## 🔧 Common Issues & Solutions

### Issue 1: CORS Errors

**Solution**: Ensure `FRONTEND_URL` in backend matches your Vercel URL exactly (no trailing slash)

### Issue 2: API Connection Failed

**Solution**: Check that `NEXT_PUBLIC_API_URL` in frontend uses `https://` not `http://`

### Issue 3: MongoDB Connection Timeout

**Solution**: Whitelist `0.0.0.0/0` in MongoDB Atlas Network Access

### Issue 4: Environment Variables Not Working

**Solution**:

- Restart/redeploy the service after adding variables
- Check variable names match exactly (case-sensitive)

### Issue 5: Build Fails on Render

**Solution**:

- Check logs in Render dashboard
- Ensure all dependencies are in `package.json`
- Try running `npm run build` locally first

### Issue 6: Vercel Build Fails

**Solution**:

- Check build logs
- Ensure Next.js version is compatible
- Clear build cache and redeploy

---

## 📊 Monitoring & Logs

### Render Logs

- Dashboard → Your Service → Logs
- View real-time logs
- Check for errors

### Vercel Logs

- Dashboard → Your Project → Deployments
- Click on deployment → View Logs
- Monitor function invocations

---

## 🔒 Security Checklist

- [ ] Never commit `.env` files
- [ ] Use strong JWT_SECRET
- [ ] Enable MongoDB authentication
- [ ] Use HTTPS only in production
- [ ] Set proper CORS origins
- [ ] Use environment variables for all secrets
- [ ] Enable rate limiting (optional but recommended)

---

## 🎉 Success Verification

After deployment, test:

1. ✅ Visit frontend: `https://your-app.vercel.app`
2. ✅ Check Swagger: `https://your-backend.onrender.com/docs`
3. ✅ Test login/register
4. ✅ Create a course (if instructor)
5. ✅ Enroll in a course (if student)
6. ✅ Download certificate

---

## 📝 Deployment URLs Template

Save these for reference:

```
Backend URL: https://elearning-backend-xxxxx.onrender.com
Frontend URL: https://elearning-frontend-xxxxx.vercel.app
Swagger Docs: https://elearning-backend-xxxxx.onrender.com/docs
MongoDB Atlas: https://cloud.mongodb.com
```

---

## 🔄 Continuous Deployment

Both Render and Vercel support automatic deployments:

- **Push to `main` branch** → Auto-deploys on both platforms
- **Preview deployments** (Vercel) → Every PR gets a preview URL
- **Rollback** → Revert to previous deployment if issues occur

---

## 💰 Cost Considerations

### Free Tier Limits:

**Render (Free)**:

- 750 hours/month
- Sleeps after 15 mins of inactivity
- Slower cold starts

**Vercel (Free)**:

- 100 GB bandwidth/month
- Unlimited deployments
- Fast global CDN

**Upgrade when needed** for:

- No sleep mode
- More resources
- Better performance

---

## 🆘 Need Help?

- **Render Docs**: https://render.com/docs
- **Vercel Docs**: https://vercel.com/docs
- **MongoDB Atlas Docs**: https://docs.atlas.mongodb.com

Good luck with your deployment! 🚀
