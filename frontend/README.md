# Gastronomix Inventory Management - Frontend

## Setup Instructions

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Create Environment File**
   Create a `.env` file in the `frontend` directory with:
   ```env
   VITE_SUPABASE_URL=your_supabase_project_url
   VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
   ```
   
   Get these values from your Supabase project settings.

3. **Run Development Server**
   ```bash
   npm run dev
   ```

## Login Credentials

Based on the seed data:

- **Admin**: Email + Password (configured in Supabase Auth)
  - Email: `admin@gastronomix.com`
  
- **Purchase Manager**: Key-based login
  - Key: `PM-KEY-2024-ABC123XYZ`
  
- **Supervisor**: Key-based login
  - Key: `SUP-KEY-2024-DEF456UVW`

## Tech Stack

- React 19
- Vite
- Tailwind CSS
- Supabase Client
