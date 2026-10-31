# Chronos – Interview Scheduler

A constraint-based interview scheduling platform built for **Webster 2026 – CodeSangam**.

Chronos helps coordinators organize interview schedules while accounting for candidate choices, interviewer availability, and scheduling constraints. It provides role-oriented workflows for coordinators, interviewers, and candidates.

## Features

- **Role-based workflows** for coordinators, interviewers, and candidates.
- **Interview scheduling** with scheduling inputs and constraints.
- **Interviewer availability** submission and management.
- **Candidate choices** and interview booking options.
- **Account invitations** for onboarding users.
- **Notifications and email support** for relevant interview and account workflows.
- **PostgreSQL persistence** for application data.

> Features and workflows may evolve as the project develops.

## Tech Stack

| Layer | Technologies |
|---|---|
| Frontend | React, Vite, JavaScript |
| Backend | Node.js, Express.js |
| Database | PostgreSQL |
| Authentication / sessions | Express Session, PostgreSQL session store |
| Email | Nodemailer |

## Project Structure

```text
chronos-interview-scheduler/
├── backend/
│   ├── migrations/       # Database SQL scripts
│   ├── server.js         # Express application entry point
│   ├── db.js             # PostgreSQL connection
│   └── package.json
├── frontend/
│   ├── src/              # React application source
│   ├── index.html
│   └── package.json
└── README.md
```

## Getting Started

### Prerequisites

Install the following before running Chronos:

- Node.js and npm
- PostgreSQL
- Git

### 1. Clone the repository

```bash
git clone <https://github.com/ankitsah823983-byte/chronos-interview-scheduler>
cd chronos-interview-scheduler
```

### 2. Configure the backend

```bash
cd backend
npm install
```

Create your local environment file from the example:

**Windows PowerShell**
```powershell
Copy-Item .env.example .env
```

**macOS / Linux**
```bash
cp .env.example .env
```

Update `backend/.env` with your local PostgreSQL credentials and the required application configuration. 

### 3. Set up PostgreSQL

Create a **new, empty local database** for your Chronos installation. Configure its name and credentials in `backend/.env`.

The SQL scripts are located in `backend/migrations/`. Review the migration files and apply the required schema scripts to the new database in the appropriate order before starting the application.

**Important:** Some SQL scripts are intended for rollback or schema rebuilding. In particular, do not run a rebuild or rollback script against a database containing data you want to keep. Never use your existing personal/development database as a fresh-install target.

### 4. Configure the frontend

Open a second terminal:

```bash
cd frontend
npm install
```

The frontend uses `VITE_API_URL` to locate the backend. The default development URL is:

```env
VITE_API_URL=http://localhost:5000
```

You can create `frontend/.env` with that setting if you need to use a different backend URL. The repository includes `frontend/.env.example` as a reference.

### 5. Run the application

Start the backend:

```bash
cd backend
npm run check
npm start
```

If the backend package does not define a `start` script in your checkout, use:

```bash
node server.js
```

Start the frontend in another terminal:

```bash
cd frontend
npm run dev
```

Vite prints the local frontend URL in the terminal (usually `http://localhost:5173`).

## Useful Commands

### Frontend

Run from `frontend/`:

```bash
npm run dev       # Start the development server
npm run build     # Create a production build
npm run preview   # Preview the production build
npm run lint      # Run the configured linter
```

### Backend

Run from `backend/`:

```bash
npm run check     # Check selected backend files for JavaScript syntax errors
```

## Environment Variables

The backend configuration is documented in `backend/.env.example`. It includes settings for:

- Server port and environment
- PostgreSQL connection
- Session secret
- Frontend origin
- Optional SMTP email configuration
- Invitation-token encryption
- Email delivery worker
- Optional coordinator account setup

The frontend configuration is documented in `frontend/.env.example`.

Do not commit `.env` files, passwords, session secrets, SMTP credentials, encryption keys, database dumps, or personal data.

## Notes

- Use a separate, empty database for a fresh local setup.
- Do not run destructive rebuild or rollback SQL scripts casually.
- Email delivery depends on valid SMTP configuration. Keep email credentials out of source control.
- The backend syntax-check command checks selected files; it is not a substitute for a complete automated test suite.

## Project Status

Chronos is a project developed for **Webster 2026 – CodeSangam**. This repository is intended to present the project, its implementation, and its development setup.

## Contributors
Team Members:
Ankit Kumar Sah:https://github.com/ankitsah823983-byte
Nitin Yadav:https://github.com/nitinyadav4433-a11y
Ankur Raj:https://github.com/Ankur0788-raj
