# Dokploy Supabase Configuration Guide

This document summarizes the configuration issues and solutions encountered when deploying self-hosted Supabase on Dokploy (Hetzner VPS).

---

## Table of Contents

1. [Environment Variables](#1-environment-variables)
2. [Domain Configuration](#2-domain-configuration)
3. [Database Migration](#3-database-migration)
4. [Auth Service (GoTrue)](#4-auth-service-gotrue)
5. [Storage Service](#5-storage-service)
6. [Realtime Service (WebSockets)](#6-realtime-service-websockets)
7. [Google OAuth](#7-google-oauth)
8. [Network Aliases](#8-network-aliases)

---

## 1. Environment Variables

Update these environment variables in Dokploy for your Supabase project:

```env
# Core URLs
SUPABASE_HOST=supabase.yourdomain.com
SUPABASE_PUBLIC_URL=https://supabase.yourdomain.com
API_EXTERNAL_URL=https://supabase.yourdomain.com

# App URLs
SITE_URL=https://app.yourdomain.com
ADDITIONAL_REDIRECT_URLS=https://app.yourdomain.com/*,https://supabase.yourdomain.com/*,http://localhost:3000/*
```

**Pain Point:** Default values point to traefik.me URLs which won't work for production.

---

## 2. Domain Configuration

### Adding Custom Domain to Kong

1. Go to Dokploy → Supabase project → Domains
2. Add domain to **Kong** service (not Studio)
3. Set **Port: 8000** (Kong's HTTP port)
4. Enable HTTPS with Let's Encrypt

**Pain Point:** Adding domain to wrong service or wrong port causes 502/503 errors.

| Service | Port | Purpose |
|---------|------|---------|
| Kong | 8000 | API Gateway (your app connects here) |
| Studio | 3000 | Admin dashboard |

---

## 3. Database Migration

### Exporting from Supabase Cloud

```bash
# Use plain SQL format for compatibility
pg_dump "postgresql://postgres:PASSWORD@db.PROJECT.supabase.co:5432/postgres" \
  --clean \
  --if-exists \
  --quote-all-identifiers \
  --no-owner \
  --no-privileges \
  --exclude-schema=_realtime \
  --exclude-schema=_analytics \
  --exclude-schema=supabase_migrations \
  --exclude-schema=supabase_functions \
  -F p \
  -f backup.sql
```

### Importing to Self-Hosted

```bash
# Copy to VPS
scp backup.sql root@<YOUR_VPS_IP>:/tmp/

# SSH and import
ssh root@<YOUR_VPS_IP>
docker cp /tmp/backup.sql CONTAINER_NAME:/tmp/
docker exec -it CONTAINER_NAME psql -U postgres -d postgres -f /tmp/backup.sql
```

**Pain Point:** Using custom format (`-F c`) may cause version mismatch errors. Use plain SQL (`-F p`) instead.

---

## 4. Auth Service (GoTrue)

### Schema Ownership Issues

After importing, GoTrue crashes with permission errors. Fix by changing ownership:

```bash
docker exec -it SUPABASE_DB_CONTAINER psql -U supabase_admin -d postgres
```

```sql
-- Change auth schema ownership
ALTER SCHEMA auth OWNER TO supabase_auth_admin;

-- Change all table owners
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'auth'
    LOOP
        EXECUTE 'ALTER TABLE auth.' || quote_ident(r.tablename) || ' OWNER TO supabase_auth_admin';
    END LOOP;
END $$;

-- Change all sequence owners
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema = 'auth'
    LOOP
        EXECUTE 'ALTER SEQUENCE auth.' || quote_ident(r.sequence_name) || ' OWNER TO supabase_auth_admin';
    END LOOP;
END $$;

-- Change all type owners
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN SELECT typname FROM pg_type t
             JOIN pg_namespace n ON t.typnamespace = n.oid
             WHERE n.nspname = 'auth' AND t.typtype = 'e'
    LOOP
        EXECUTE 'ALTER TYPE auth.' || quote_ident(r.typname) || ' OWNER TO supabase_auth_admin';
    END LOOP;
END $$;

-- Grant privileges
GRANT ALL ON SCHEMA auth TO supabase_auth_admin;
GRANT ALL ON ALL TABLES IN SCHEMA auth TO supabase_auth_admin;
GRANT ALL ON ALL SEQUENCES IN SCHEMA auth TO supabase_auth_admin;
```

**Pain Point:** `postgres` user is NOT superuser in Supabase. Use `supabase_admin` instead.

### Migration Conflicts

If migrations fail due to existing objects:

```sql
-- Skip a specific migration version
INSERT INTO auth.schema_migrations (version)
VALUES ('20221208132122')
ON CONFLICT DO NOTHING;
```

---

## 5. Storage Service

### Schema Ownership Issues

Same as auth, fix storage schema ownership:

```sql
-- Change storage schema ownership
ALTER SCHEMA storage OWNER TO supabase_storage_admin;

-- Change all tables
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'storage'
    LOOP
        EXECUTE 'ALTER TABLE storage.' || quote_ident(r.tablename) || ' OWNER TO supabase_storage_admin';
    END LOOP;
END $$;

-- Change all sequences
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema = 'storage'
    LOOP
        EXECUTE 'ALTER SEQUENCE storage.' || quote_ident(r.sequence_name) || ' OWNER TO supabase_storage_admin';
    END LOOP;
END $$;

-- Grant privileges
GRANT ALL ON SCHEMA storage TO supabase_storage_admin;
GRANT ALL ON ALL TABLES IN SCHEMA storage TO supabase_storage_admin;
GRANT ALL ON ALL SEQUENCES IN SCHEMA storage TO supabase_storage_admin;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA storage TO supabase_storage_admin;
```

---

## 6. Realtime Service (WebSockets)

### DNS Resolution Issue

**Symptom:** WebSocket connections fail with "name resolution failed"

**Cause:** Kong config expects hostname `realtime-dev.supabase-realtime` but container has different name.

**Solution:** Edit Kong config file (`kong.yml`) in Dokploy Mounts section:

```yaml
# Find realtime-v1-ws section, change:
url: http://realtime-dev.supabase-realtime:4000/socket
# To:
url: http://realtime-dev.<CONTAINER_PREFIX>-realtime:4000/socket

# Find realtime-v1-rest section, change:
url: http://realtime-dev.supabase-realtime:4000/api
# To:
url: http://realtime-dev.<CONTAINER_PREFIX>-realtime:4000/api
```

Find your container prefix:
```bash
docker ps | grep realtime
```

After editing, restart Kong:
```bash
docker restart KONG_CONTAINER_NAME
```

---

## 7. Google OAuth

### Configure in Docker Compose

Add to `auth` service environment:

```yaml
auth:
  environment:
    # ... existing vars ...
    GOTRUE_EXTERNAL_GOOGLE_ENABLED: "true"
    GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID: "<YOUR_GOOGLE_CLIENT_ID>"
    GOTRUE_EXTERNAL_GOOGLE_SECRET: "<YOUR_GOOGLE_CLIENT_SECRET>"
    GOTRUE_EXTERNAL_GOOGLE_REDIRECT_URI: "https://supabase.yourdomain.com/auth/v1/callback"
```

### Add DNS for Auth Container

If auth service can't resolve external domains, add DNS:

```yaml
auth:
  dns:
    - 8.8.8.8
    - 8.8.4.4
```

### Update Google Cloud Console

Add authorized redirect URI:
```
https://supabase.yourdomain.com/auth/v1/callback
```

---

## 8. Network Aliases

### Storage Service Alias

If Kong can't resolve `storage`, add network alias in docker-compose:

```yaml
storage:
    container_name: ${CONTAINER_PREFIX}-storage
    networks:
      <NETWORK_NAME>:
        aliases:
          - storage
```

Find your network name:
```bash
docker network ls | grep supabase
```

---

## Quick Reference

### Container Names Pattern

```
${CONTAINER_PREFIX}-SERVICE_NAME
```

Example container names:
- `<CONTAINER_PREFIX>-kong`
- `<CONTAINER_PREFIX>-auth`
- `<CONTAINER_PREFIX>-storage`
- `<CONTAINER_PREFIX>-db`
- `realtime-dev.<CONTAINER_PREFIX>-realtime`

### Database Users

| User | Purpose | Superuser |
|------|---------|-----------|
| `supabase_admin` | Admin operations | Yes |
| `postgres` | Default user | No |
| `supabase_auth_admin` | Auth service | No |
| `supabase_storage_admin` | Storage service | No |

### Useful Commands

```bash
# Check container status
docker ps | grep supabase

# View container logs
docker logs CONTAINER_NAME --tail 50

# Enter database
docker exec -it DB_CONTAINER psql -U supabase_admin -d postgres

# Restart a service
docker restart CONTAINER_NAME

# Check network aliases
docker inspect CONTAINER_NAME | grep -A 20 "Aliases"

# Test DNS from Kong
docker exec KONG_CONTAINER ping -c 1 HOSTNAME
```

---

## App Environment Variables

Update your app (e.g., Next.js) environment variables:

```env
NEXT_PUBLIC_SUPABASE_URL=https://supabase.yourdomain.com
NEXT_PUBLIC_SUPABASE_ANON_KEY=<YOUR_ANON_KEY>
SUPABASE_SERVICE_ROLE_KEY=<YOUR_SERVICE_ROLE_KEY>
```

---

## Troubleshooting

| Error | Cause | Solution |
|-------|-------|----------|
| `502 Bad Gateway` | Wrong port on domain | Set port to 8000 for Kong |
| `name resolution failed` | DNS issue in Docker | Update Kong config or add network alias |
| `must be owner of table` | Permission issue | Run ownership SQL as `supabase_admin` |
| `Migration failed` | Schema conflicts | Skip migration or fix ownership |
| `WebSocket failed` | Realtime DNS issue | Update Kong config with correct container name |
