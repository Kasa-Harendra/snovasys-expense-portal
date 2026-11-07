# Role-Based Expense Reimbursement Portal

A secure, enterprise-grade Role-Based Expense Reimbursement Portal built with **FastAPI**, **PostgreSQL**, and **React**.

## System Architecture

- **Backend**: Python 3.11+ with FastAPI, SQLAlchemy 2.0 ORM, Alembic migrations, Pydantic v2 validation.
- **Frontend**: React 18 with TypeScript, Vite bundler.
- **Database**: PostgreSQL with strict constraints and an immutable audit log architecture.
- **Security Focus**: Strict Role-Based Access Control (RBAC), IDOR prevention, Mass Assignment mitigation, and tamper-proof audit trails.

## Roles & Access Control
- `EMPLOYEE`: Create and view own expenses, update DRAFT expenses, submit for approval.
- `MANAGER`: Review and approve/reject expenses submitted by their direct reports.
- `FINANCE`: Review approved expenses, mark as PAID, view complete immutable audit history across all expenses.

## Project Structure

```
├── backend/
│   ├── src/
│   │   ├── config/          # App and environment configurations
│   │   └── main.py          # FastAPI application entry point
│   ├── pyproject.toml       # Linter and test configurations (Ruff / Pytest)
│   ├── requirements.txt     # Python dependencies
│   └── .env.example         # Environment template
├── frontend/
│   ├── src/
│   │   ├── App.tsx          # Main React component
│   │   ├── main.tsx         # React DOM mount point
│   │   └── index.css        # Clean theme styling
│   ├── package.json         # Node dependencies & scripts
│   ├── vite.config.ts       # Vite build configuration
│   └── tsconfig.json        # TypeScript configuration
├── .gitignore               # Multi-environment ignore rules
└── README.md                # Project documentation
```

## Getting Started

### Backend Setup
```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn src.main:app --reload --port 8000
```

### Frontend Setup
```bash
cd frontend
npm install
npm run dev
```
