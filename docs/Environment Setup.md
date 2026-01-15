# Environment Setup
## Gastronomix Inventory Management System

This document outlines the environment variables required for the project.

---

## Required Environment Variables

Create a `.env` file in the project root with the following variables:

```env
# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_YbOJ_g09hCR3fiep6SUiTg_3ffc9cdK
SUPABASE_SERVICE_ROLE_KEY=sb_secret_99ZQ4PkW3XCE5dmDb-lugw_90rd-hvh
```

---

## Supabase Configuration

### Current Credentials

**Publishable Key (Anon Key):**
```
sb_publishable_YbOJ_g09hCR3fiep6SUiTg_3ffc9cdK
```

**Secret Key (Service Role Key):**
```
sb_secret_99ZQ4PkW3XCE5dmDb-lugw_90rd-hvh
```

**Supabase Project URL:**
- You'll need to get this from your Supabase project dashboard
- Format: `https://<project-ref>.supabase.co`

---

## Setup Instructions

1. **Create `.env` file** in the project root:
   ```bash
   touch .env
   ```

2. **Add the environment variables** (copy the template above and fill in your Supabase URL)

3. **Get your Supabase Project URL:**
   - Go to https://app.supabase.com
   - Select your project
   - Go to Settings → API
   - Copy the "Project URL"

4. **Update `.env` file** with your actual Supabase URL

---

## Security Notes

- ⚠️ **Never commit `.env` file to version control**
- ✅ Add `.env` to `.gitignore`
- ✅ Use `.env.example` as a template (without actual keys)
- ⚠️ The Service Role Key has admin access - keep it secure
- ✅ Use the Anon Key in client-side code
- ⚠️ Only use Service Role Key in server-side code/Edge Functions

---

## Variable Usage

- `NEXT_PUBLIC_SUPABASE_URL`: Supabase project URL (public, used in client)
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Public anon key (safe for client-side)
- `SUPABASE_SERVICE_ROLE_KEY`: Secret service role key (server-side only, bypasses RLS)

---

## Next Steps

After setting up environment variables:
1. Install dependencies: `npm install` or `yarn install`
2. Set up Supabase client configuration
3. Run database migrations
4. Start development server


