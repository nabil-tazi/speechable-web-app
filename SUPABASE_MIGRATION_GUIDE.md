# Supabase Migration Guide: Cloud to Self-Hosted (Dokploy)

This guide walks you through migrating your Readible Supabase instance from the free cloud plan to a self-hosted Supabase on Dokploy (Hetzner VPS).

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Deploy Self-Hosted Supabase on Dokploy](#2-deploy-self-hosted-supabase-on-dokploy)
3. [Configure DNS and SSL](#3-configure-dns-and-ssl)
4. [Export Data from Supabase Cloud](#4-export-data-from-supabase-cloud)
5. [Import Data to Self-Hosted Supabase](#5-import-data-to-self-hosted-supabase)
6. [Migrate Storage Files](#6-migrate-storage-files)
7. [Configure Authentication](#7-configure-authentication)
8. [Update Your Application](#8-update-your-application)
9. [Verify Migration](#9-verify-migration)
10. [Cleanup](#10-cleanup)

---

## 1. Prerequisites

Before starting, ensure you have:

- [ ] Access to your Dokploy dashboard
- [ ] Access to your Supabase Cloud project dashboard
- [ ] A domain or subdomain for your self-hosted Supabase (e.g., `supabase.yourdomain.com`)
- [ ] PostgreSQL client tools installed locally:
  ```bash
  # macOS
  brew install postgresql@17

  # Ubuntu/Debian
  sudo apt install postgresql-client-17

  # Or use Docker
  docker pull postgres:17
  ```
- [ ] Supabase CLI installed:
  ```bash
  npm install -g supabase
  ```

---

## 2. Deploy Self-Hosted Supabase on Dokploy

### Step 2.1: Create Supabase from Template

1. Log into your Dokploy dashboard
2. Click **"Create Project"** or go to an existing project
3. Click **"Templates"** in the sidebar
4. Search for **"Supabase"**
5. Click **"Deploy"**

### Step 2.2: Configure Environment Variables

Dokploy will auto-generate some secrets, but verify these are set:

| Variable | Description | Action |
|----------|-------------|--------|
| `POSTGRES_PASSWORD` | Database password | Auto-generated (save this!) |
| `JWT_SECRET` | JWT signing secret | Auto-generated (save this!) |
| `ANON_KEY` | Public anonymous key | Auto-generated |
| `SERVICE_ROLE_KEY` | Service role key (admin) | Auto-generated |
| `DASHBOARD_USERNAME` | Studio login username | Set to your email |
| `DASHBOARD_PASSWORD` | Studio login password | Set a strong password |

### Step 2.3: Wait for Services to Start

Supabase consists of multiple services. Wait for all to show "Running":

- `supabase-db` (PostgreSQL)
- `supabase-auth` (GoTrue)
- `supabase-rest` (PostgREST)
- `supabase-realtime`
- `supabase-storage`
- `supabase-studio`
- `supabase-meta`
- `supabase-kong` (API Gateway)

This may take 2-5 minutes on first deployment.

---

## 3. Configure DNS and SSL

### Step 3.1: Add Domain in Dokploy

1. Go to your Supabase project in Dokploy
2. Find the **Kong** service (API Gateway)
3. Go to **Domains** tab
4. Add your domain: `supabase.yourdomain.com`
5. Enable **HTTPS** (Let's Encrypt)

### Step 3.2: Configure DNS Records

In your DNS provider, add:

```
Type: A
Name: supabase (or your subdomain)
Value: <Your Hetzner VPS IP>
TTL: 300
```

### Step 3.3: Also Add Domain for Studio (Optional)

If you want a separate domain for Supabase Studio:

1. Find the **Studio** service
2. Add domain: `studio.supabase.yourdomain.com`
3. Enable HTTPS

### Step 3.4: Wait for SSL Certificate

Let's Encrypt certificates may take 1-5 minutes to provision. Check that HTTPS works:

```bash
curl -I https://supabase.yourdomain.com/rest/v1/
```

---

## 4. Export Data from Supabase Cloud

### Step 4.1: Get Cloud Database Credentials

1. Go to [supabase.com/dashboard](https://supabase.com/dashboard)
2. Select your project
3. Go to **Settings** → **Database**
4. Scroll to **Connection string** section
5. Copy the **URI** connection string (looks like):
   ```
   postgresql://postgres.[PROJECT-REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres
   ```

### Step 4.2: Export the Full Database

Run this command to export everything:

```bash
# Create a backup directory
mkdir -p ~/supabase-backup
cd ~/supabase-backup

# Export the database (replace with your connection string)
pg_dump "postgresql://postgres.[PROJECT-REF]:[YOUR-PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres" \
  --clean \
  --if-exists \
  --quote-all-identifiers \
  --no-owner \
  --no-privileges \
  --exclude-schema=_realtime \
  --exclude-schema=_analytics \
  --exclude-schema=supabase_migrations \
  --exclude-schema=supabase_functions \
  -F c \
  -f readible_backup.dump

echo "Database exported to readible_backup.dump"
```

**Explanation of flags:**
- `--clean --if-exists`: Drop existing objects before creating
- `--no-owner --no-privileges`: Don't export ownership (different in self-hosted)
- `--exclude-schema`: Skip Supabase internal schemas
- `-F c`: Custom format (compressed, supports parallel restore)

### Step 4.3: Export Schema Only (Optional Backup)

For a human-readable SQL backup:

```bash
pg_dump "postgresql://postgres.[PROJECT-REF]:[YOUR-PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres" \
  --schema-only \
  --no-owner \
  --no-privileges \
  -f readible_schema.sql
```

### Step 4.4: Verify the Export

```bash
# Check file size (should be > 0)
ls -lh readible_backup.dump

# List contents
pg_restore --list readible_backup.dump | head -50
```

---

## 5. Import Data to Self-Hosted Supabase

### Step 5.1: Get Self-Hosted Database Credentials

In Dokploy, find the `supabase-db` service environment variables:

- **Host**: Usually the service name or exposed port
- **Port**: 5432 (internal) or mapped port
- **User**: `postgres`
- **Password**: The `POSTGRES_PASSWORD` you saved
- **Database**: `postgres`

If database is not exposed externally, you can:

**Option A: Use Dokploy's terminal feature**
1. Go to `supabase-db` service
2. Click "Terminal" or "Console"
3. Run psql commands directly

**Option B: Temporarily expose the port**
1. Add port mapping: `5432:5432`
2. Import data
3. Remove port mapping after

**Option C: Use SSH tunnel**
```bash
ssh -L 5432:localhost:5432 user@your-vps-ip
```

### Step 5.2: Connect and Test

```bash
# Test connection (replace with your credentials)
psql "postgresql://postgres:[PASSWORD]@[HOST]:[PORT]/postgres" -c "SELECT version();"
```

### Step 5.3: Import the Database

```bash
# Restore from the dump file
pg_restore \
  --dbname="postgresql://postgres:[PASSWORD]@[HOST]:[PORT]/postgres" \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  --single-transaction \
  readible_backup.dump

echo "Database restored successfully"
```

### Step 5.4: Verify Import

```bash
# Connect and check tables
psql "postgresql://postgres:[PASSWORD]@[HOST]:[PORT]/postgres" << EOF
-- List all tables in public schema
SELECT tablename FROM pg_tables WHERE schemaname = 'public';

-- Check row counts
SELECT 'users' as table_name, count(*) FROM users
UNION ALL
SELECT 'documents', count(*) FROM documents
UNION ALL
SELECT 'document_versions', count(*) FROM document_versions;

-- Check auth users
SELECT count(*) as auth_users FROM auth.users;
EOF
```

---

## 6. Migrate Storage Files

Your app uses these storage buckets:
- `version-audio` - Audio files for TTS
- `document-thumbnails` - Document thumbnail images
- `avatars` - User profile images

### Step 6.1: List Existing Buckets in Cloud

```bash
# Using Supabase CLI (login first)
supabase login
supabase storage ls --project-ref [YOUR-PROJECT-REF]
```

Or check via the Supabase Dashboard → Storage.

### Step 6.2: Create Buckets in Self-Hosted Supabase

1. Open your self-hosted Supabase Studio:
   ```
   https://studio.supabase.yourdomain.com
   ```
   Or access via Dokploy's exposed port.

2. Go to **Storage** in the sidebar

3. Create these buckets with matching settings:

   | Bucket | Public | File Size Limit |
   |--------|--------|-----------------|
   | `version-audio` | No (private) | 50MB |
   | `document-thumbnails` | Yes (public) | 10MB |
   | `avatars` | Yes (public) | 5MB |

### Step 6.3: Download Files from Cloud Storage

Create a script to download all files:

```bash
#!/bin/bash
# download_storage.sh

PROJECT_REF="your-project-ref"
SERVICE_KEY="your-service-role-key"
API_URL="https://${PROJECT_REF}.supabase.co"

mkdir -p storage_backup/{version-audio,document-thumbnails,avatars}

# Function to download bucket contents
download_bucket() {
  BUCKET=$1
  echo "Downloading bucket: $BUCKET"

  # List files
  FILES=$(curl -s \
    -H "Authorization: Bearer ${SERVICE_KEY}" \
    -H "apikey: ${SERVICE_KEY}" \
    "${API_URL}/storage/v1/object/list/${BUCKET}" \
    | jq -r '.[].name')

  for FILE in $FILES; do
    echo "  Downloading: $FILE"
    curl -s \
      -H "Authorization: Bearer ${SERVICE_KEY}" \
      -H "apikey: ${SERVICE_KEY}" \
      "${API_URL}/storage/v1/object/${BUCKET}/${FILE}" \
      -o "storage_backup/${BUCKET}/${FILE}"
  done
}

download_bucket "version-audio"
download_bucket "document-thumbnails"
download_bucket "avatars"

echo "Storage backup complete!"
```

Make it executable and run:
```bash
chmod +x download_storage.sh
./download_storage.sh
```

### Step 6.4: Upload Files to Self-Hosted Storage

```bash
#!/bin/bash
# upload_storage.sh

SERVICE_KEY="your-self-hosted-service-role-key"
API_URL="https://supabase.yourdomain.com"

upload_bucket() {
  BUCKET=$1
  echo "Uploading to bucket: $BUCKET"

  for FILE in storage_backup/${BUCKET}/*; do
    FILENAME=$(basename "$FILE")
    echo "  Uploading: $FILENAME"

    curl -X POST \
      -H "Authorization: Bearer ${SERVICE_KEY}" \
      -H "apikey: ${SERVICE_KEY}" \
      -H "Content-Type: application/octet-stream" \
      --data-binary "@${FILE}" \
      "${API_URL}/storage/v1/object/${BUCKET}/${FILENAME}"
  done
}

upload_bucket "version-audio"
upload_bucket "document-thumbnails"
upload_bucket "avatars"

echo "Storage upload complete!"
```

### Step 6.5: Set Bucket Policies

In Supabase Studio, set RLS policies for each bucket. Example for `avatars`:

```sql
-- Allow users to upload their own avatar
CREATE POLICY "Users can upload own avatar"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Allow public read
CREATE POLICY "Avatars are publicly readable"
ON storage.objects FOR SELECT
USING (bucket_id = 'avatars');
```

Check your existing policies in Cloud Supabase and replicate them.

---

## 7. Configure Authentication

### Step 7.1: Configure Auth Settings

In self-hosted Supabase Studio → Authentication → Settings:

1. **Site URL**: `https://readible.yourdomain.com` (your app URL)
2. **Redirect URLs**: Add all allowed redirect URLs:
   ```
   https://readible.yourdomain.com/**
   http://localhost:3000/**
   ```

### Step 7.2: Configure Google OAuth (if used)

Based on your build logs, you're using Google OAuth:

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Navigate to **APIs & Services** → **Credentials**
3. Find your OAuth 2.0 Client ID
4. Add new **Authorized redirect URI**:
   ```
   https://supabase.yourdomain.com/auth/v1/callback
   ```
5. Save changes

In Supabase Studio → Authentication → Providers → Google:
- Enable Google provider
- Add your Client ID
- Add your Client Secret

### Step 7.3: Verify Auth Users Migrated

Auth users are stored in the `auth.users` table and should have been migrated with the database dump:

```sql
-- Check auth users
SELECT id, email, created_at, last_sign_in_at
FROM auth.users
LIMIT 10;
```

**Important**: User passwords are hashed with bcrypt and will work in the new instance. Users can log in with their existing passwords.

---

## 8. Update Your Application

### Step 8.1: Update Environment Variables in Dokploy

Go to your `readible-web-app` in Dokploy and update these environment variables:

```env
# New self-hosted Supabase URLs
NEXT_PUBLIC_SUPABASE_URL=https://supabase.yourdomain.com
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-new-anon-key

# Server-side only
SUPABASE_SERVICE_ROLE_KEY=your-new-service-role-key

# Remove or update any old cloud references
```

### Step 8.2: Get Your New Keys

In Dokploy, find these in your Supabase environment variables:
- `ANON_KEY` → use as `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SERVICE_ROLE_KEY` → use as `SUPABASE_SERVICE_ROLE_KEY`

Or generate them in Supabase Studio → Settings → API.

### Step 8.3: Redeploy Your Application

In Dokploy:
1. Go to your `readible-web-app`
2. Click **Redeploy** or push a new commit

### Step 8.4: Update Local Development (Optional)

Update your `.env.local` file:

```env
NEXT_PUBLIC_SUPABASE_URL=https://supabase.yourdomain.com
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-new-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-new-service-role-key
```

---

## 9. Verify Migration

### Step 9.1: Test Database Connection

```bash
# Your app should be able to fetch data
curl https://readible.yourdomain.com/api/health
```

### Step 9.2: Test Authentication

1. Open your app: `https://readible.yourdomain.com`
2. Try logging in with an existing user
3. Try signing up a new user
4. Try Google OAuth login (if configured)

### Step 9.3: Test Storage

1. Upload a new document
2. Check if thumbnail is generated
3. Play audio (if TTS is used)

### Step 9.4: Check Supabase Studio

1. Open Studio: `https://studio.supabase.yourdomain.com`
2. Verify all tables have data
3. Check Storage buckets have files
4. Review Auth users list

### Step 9.5: Test RLS Policies

```bash
# Test with anon key (should respect RLS)
curl -H "apikey: YOUR_ANON_KEY" \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  https://supabase.yourdomain.com/rest/v1/documents

# Should return empty or error (not authenticated)
```

---

## 10. Cleanup

### Step 10.1: Monitor for Issues

Run both instances in parallel for a few days:
- Monitor error logs in Dokploy
- Check Supabase logs for any issues
- Verify all features work correctly

### Step 10.2: Update DNS (if using custom domain)

If your app was pointing to Supabase Cloud via a custom domain, update it.

### Step 10.3: Backup Self-Hosted Instance

Set up regular backups for your self-hosted instance:

```bash
# Add to cron (daily backup)
0 2 * * * pg_dump "postgresql://postgres:PASSWORD@localhost:5432/postgres" -F c -f /backups/supabase_$(date +\%Y\%m\%d).dump
```

### Step 10.4: Delete Cloud Project (When Ready)

**Only after verifying everything works:**

1. Go to Supabase Cloud Dashboard
2. Settings → General
3. Scroll to "Delete Project"
4. Confirm deletion

**Warning**: This is irreversible. Make sure you have:
- [ ] All data migrated and verified
- [ ] All storage files migrated
- [ ] App working with self-hosted instance for at least 1 week
- [ ] Backups of everything

---

## Troubleshooting

### Connection Refused

```
Error: connection refused
```

- Check if database port is exposed
- Verify firewall rules on Hetzner VPS
- Check Dokploy service is running

### Auth Users Can't Login

```
Error: Invalid login credentials
```

- Verify `auth.users` table was imported
- Check JWT_SECRET matches between services
- Ensure Site URL is configured correctly

### Storage Upload Fails

```
Error: Bucket not found
```

- Create buckets manually in Studio
- Check bucket names match exactly
- Verify RLS policies allow uploads

### CORS Errors

```
Error: CORS policy blocked
```

- Add your app domain to allowed origins in Kong config
- Check Supabase API Gateway settings

### SSL Certificate Issues

```
Error: SSL certificate problem
```

- Wait 5 minutes for Let's Encrypt
- Check DNS is pointing to correct IP
- Verify domain in Dokploy matches DNS

---

## Quick Reference

| What | Cloud | Self-Hosted |
|------|-------|-------------|
| API URL | `https://xxx.supabase.co` | `https://supabase.yourdomain.com` |
| Studio | `https://supabase.com/dashboard` | `https://studio.supabase.yourdomain.com` |
| Database | Managed | Your VPS |
| Backups | Automatic (Pro) | Manual/Custom |
| Cost | $25+/month (Pro) | VPS cost only |

---

## Your Specific Migration Checklist

Based on your Readible app:

- [ ] Deploy Supabase on Dokploy
- [ ] Configure domain and SSL
- [ ] Export database from cloud
- [ ] Import database to self-hosted
- [ ] Create storage buckets:
  - [ ] `version-audio`
  - [ ] `document-thumbnails`
  - [ ] `avatars`
- [ ] Migrate storage files
- [ ] Configure Google OAuth redirect URI
- [ ] Update `readible-web-app` environment variables
- [ ] Redeploy app
- [ ] Test login with existing user
- [ ] Test document creation
- [ ] Test audio playback
- [ ] Monitor for 1 week
- [ ] Delete cloud project

---

Good luck with your migration!
