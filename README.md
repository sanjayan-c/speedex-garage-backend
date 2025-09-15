# Express + PostgreSQL + JWT (Access + Refresh in Cookie) Starter

Secure baseline with:
- Express, Helmet, Rate limiting, CORS
- PostgreSQL via `pg`
- JWT access tokens and refresh tokens (httpOnly cookie, rotation + revocation list)
- Role-based auth (admin/staff/user)
- Endpoints for:
  - Register (with role)
  - Login (sets refresh cookie) / Refresh / Logout
  - Update role (admin) / Update password (self or admin)
  - Staff CRUD (admin)
- Data model matches your spec (extra JSONB `untime`, `is_login`, `created_by`, `timestamp`)

## Quick Start

1. Create `.env` from example:

```bash
cp .env.example .env
```

Put your DATABASE_URL here (given in your message). Also set strong secrets.

2. Install deps:

```bash
npm i
```

3. Run migration:

```bash
npm run db:migrate
```

4. Start dev server:

```bash
npm run dev
```

## Important Env

- `JWT_ACCESS_EXPIRES_IN`: default `15m`
- `JWT_REFRESH_EXPIRES_IN`: default `7d`
- `COOKIE_NAME`: default `rt`
- `CORS_ORIGIN`: comma-separated origins allowed

## Routes

### Auth

- `POST /api/auth/register`
  Body: `{ username, password, role?, isLogin?, untime?, createdBy? }`  
  Returns: `{ id, username, role }`

- `POST /api/auth/login`
  Body: `{ username, password }`  
  Sets refresh cookie at `/api/auth/refresh`. Returns `{ accessToken, user }`.

- `POST /api/auth/refresh`
  Uses httpOnly cookie. Returns `{ accessToken }` and rotates cookie.

- `POST /api/auth/logout`
  Revokes tokens and clears cookie.

### Users

- `PATCH /api/users/role` (admin)
  Body: `{ userId, role }`

- `PATCH /api/users/password` (self or admin)
  Query (optional, admin only): `?userId=<uuid>`  
  Body (self): `{ currentPassword, newPassword }`  
  Body (admin changing other's password): `{ newPassword }`

### Staff (admin)

- `POST /api/staff`
  Body: `{ userId, firstName, lastName, email, contactNo, emergencyContactNo }`

- `GET /api/staff`
- `GET /api/staff/:id`
- `PATCH /api/staff/:id`
- `DELETE /api/staff/:id`

## Security Notes
- Refresh token is httpOnly, `secure` in production, `sameSite=none` in prod (for cross-site). Adjust `COOKIE_DOMAIN` if needed.
- Refresh tokens are hashed in DB and rotated on every refresh.
- Passwords are hashed with bcrypt (12 rounds).

## Database
Run `npm run db:migrate` to create tables. The `users.untime` is JSON:
```json
{ "startTime": "2025-09-01T08:00:00.000Z", "active": true, "durationMinutes": 30 }
```

