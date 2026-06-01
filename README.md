# 📋 Session-Based Attendance System

A QR-code-driven attendance system where an ESP32 displays a rotating, server-signed QR code. Students scan with their phone, register once, and then mark Entry/Exit with backend-enforced rules.

## Architecture

```
ESP32 + ST7789       Backend (Render)       Frontend (Vercel)       Database (Supabase)
  ┌──────────┐      ┌──────────────────┐    ┌──────────────────┐   ┌──────────────────┐
  │ Fetch    │─────▶│ GET /session/    │    │ index.html       │   │ students         │
  │ token    │      │     token        │    │ (Scan + Mark)    │   │ attendance_records│
  │ every    │◀─────│                  │    │                  │   │ used_tokens       │
  │ 15s      │      │ POST /session/   │◀───│ dashboard.html   │   └──────────────────┘
  │          │      │      verify      │    │ (Live view)      │            ▲
  │ Display  │      │ POST /student/   │────│                  │────────────┘
  │ QR code  │      │      register    │    └──────────────────┘
  └──────────┘      │ POST /attendance/│
                    │      mark        │
                    │ GET /attendance/ │
                    │      live        │
                    └──────────────────┘
```

## Quick Start

### 1. Database Setup (Supabase)

1. Create a new project at [supabase.com](https://supabase.com)
2. Go to **SQL Editor** → **New Query**
3. Copy and run `database/migration.sql`
4. Note your **Project URL** and **service_role key** from Settings → API

### 2. Backend Setup (Local)

```bash
cd backend
cp .env.example .env
# Edit .env with your Supabase credentials and a random JWT_SECRET
npm install
npm run dev
```

The backend runs on `http://localhost:3000`.

### 3. Frontend Setup (Local)

The frontend is static HTML/CSS/JS — serve it with any static server:

```bash
cd frontend
# Option 1: Python
python3 -m http.server 5500

# Option 2: npx
npx -y serve -l 5500
```

Open `http://localhost:5500` in your browser.

### 4. Test the Flow

```bash
# Generate a token (simulating ESP32)
curl http://localhost:3000/api/session/token

# Use the qrUrl from the response to open in browser
# Or manually: http://localhost:5500/?token=<token_value>
```

## Deployment

### Backend → Render

1. Push `backend/` to a GitHub repo
2. Create a **Web Service** on [render.com](https://render.com)
3. Set:
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
   - **Environment Variables**: Copy from `.env.example`
4. Set `FRONTEND_URL` to your Vercel deployment URL

### Frontend → Vercel

1. Push `frontend/` to a GitHub repo
2. Import on [vercel.com](https://vercel.com)
3. No build step needed (static files)
4. Update `js/api.js` → set `API_BASE` to your Render URL

### UptimeRobot

1. Create a monitor at [uptimerobot.com](https://uptimerobot.com)
2. Type: HTTP(s), URL: `https://<your-app>.onrender.com/api/health`
3. Interval: 5 minutes

## API Documentation

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Health check (for UptimeRobot) |
| GET | `/api/session/token` | Generate QR session token |
| POST | `/api/session/verify` | Verify scanned token |
| POST | `/api/student/register` | Register new student |
| POST | `/api/student/lookup` | Look up student + attendance state |
| POST | `/api/attendance/mark` | Mark entry or exit |
| GET | `/api/attendance/live` | Live attendance records |

## Tech Stack

- **Backend**: Node.js 20+, Express.js, JWT
- **Database**: PostgreSQL (Supabase)
- **Frontend**: Vanilla HTML/CSS/JS
- **Hardware**: ESP32 + ST7789 TFT display
- **Hosting**: Render (backend), Vercel (frontend), Supabase (database)
