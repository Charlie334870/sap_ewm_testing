# Setup guide

This guide gets the EWM Agent console running on your own computer. You do not need to be a
developer. Allow 30 minutes the first time; most of it is waiting for downloads.

Everything here is free. Nothing in this guide needs a paid SAP system or a Claude API key.

## 1. Install two programs

| Program        | What it is for                                    | Where to get it                                  |
| -------------- | ------------------------------------------------- | ------------------------------------------------ |
| Docker Desktop | Runs the database, the API and the web console    | <https://www.docker.com/products/docker-desktop> |
| Git            | Downloads the code and keeps your copy up to date | <https://git-scm.com/downloads>                  |

After installing Docker Desktop, start it and wait until it says it is running. On Windows it
may ask to enable WSL 2; accept and restart when asked.

## 2. Get the code

Open a terminal (on Windows: **PowerShell**) and run:

```bash
git clone https://github.com/Charlie334870/sap_ewm_testing.git
cd sap_ewm_testing
```

If you received the code as a zip file instead, unzip it and `cd` into the folder.

## 3. Create your settings file

The file `.env` holds your passwords. It stays on your computer and is never uploaded.

Windows (PowerShell):

```powershell
Copy-Item .env.example .env
notepad .env
```

Mac or Linux:

```bash
cp .env.example .env
open -e .env        # Mac. On Linux use any text editor.
```

Change these three values, then save and close:

| Setting                    | Set it to                                      |
| -------------------------- | ---------------------------------------------- |
| `POSTGRES_PASSWORD`        | A database password. Letters and digits only.  |
| `BOOTSTRAP_ADMIN_EMAIL`    | Your email address. You sign in with it.       |
| `BOOTSTRAP_ADMIN_PASSWORD` | Your sign-in password, at least 12 characters. |

The same database password also appears inside the two lines that start with `DATABASE_URL`.
Replace it there too.

**One more value, needed only for a real SAP connection.** `SECRETS_KEY` encrypts the SAP API key
before it is stored. Create a key with this command and paste the 64 characters it prints after
`SECRETS_KEY=` in `.env`:

```bash
docker run --rm node:22-slim node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Keep that value. If it is changed later, the stored API key can no longer be read and has to be
entered again. Without `SECRETS_KEY` everything works except registering SAP's API sandbox.

## 4. Start everything

```bash
docker compose up --build
```

The first start downloads and builds for several minutes. It is ready when you see a line
containing `Server listening` from `api` and `Ready` from `web`. Leave this window open.

## 5. Open the console

Go to <http://localhost:3000> and sign in with the email and password you put in `.env`.

## 6. Check that it works

This is the exit test of Milestone 1. Each step should work as described.

1. **Projects** → _New project_. Key `MUHW`, any name. The project appears in the list.
2. **SAP Systems** → _Register a system_. System ID `S4D`, client `100`, environment DEV. It
   appears with a yellow striped **Simulated** tag.
3. **Tickets** → _New ticket_. Title: `Warehouse task is not being created for delivery XXXXX in
warehouse MUHW.` Choose the system. The ticket opens as `MUHW-1`.
4. On the ticket, add a comment, then change the status to _Investigating_. Both appear in the
   timeline.
5. **Audit Logs**. You see _Created project_, _Registered SAP system_, _Created ticket_,
   _Commented on ticket_ and _Changed ticket status_, each with time and name. Press _Check
   integrity_: it reports that all entries check out.
6. **Users** (bottom left) → _New user_. Create a second person. Do **not** add them to the project.
7. Sign out, sign in as the second person. They see "No project yet", and the address of ticket
   `MUHW-1` shows "Project not found" for them.

## 7. Try the SAP tools (Milestone 2)

1. **SAP Systems** → open the simulated system `S4D` → _Create the practice tickets_. Three
   tickets appear under **Tickets**, each describing a symptom only.
2. On the same page, under _Run a read-only tool_, choose **Delivery**, direction `outbound`,
   delivery `80001001`, and run it. The result is marked **Simulated** and has a call ID. It also
   appears under _Recent tool calls_.
3. Choose **Warehouse tasks**, enter only warehouse `MUHW`, and run it. The call is **Refused**,
   no data is shown, and the refusal is in the list too.
4. To read from real SAP software, follow [SAP-CONNECTION.md](SAP-CONNECTION.md).
5. To let Claude investigate a ticket with these tools, follow [CONNECT-CLAUDE.md](CONNECT-CLAUDE.md).

## Stop and start again

- Stop: press `Ctrl + C` in the window from step 4, or run `docker compose down`.
- Start again: `docker compose up`. Your projects and tickets are still there.
- Start from an empty database, deleting everything: `docker compose down -v`, then start again.

## Update to a newer version

```bash
git pull
docker compose up --build
```

Database changes are applied automatically when the API starts. Your projects and tickets are kept.
If a new version adds a setting, it is listed in `.env.example`; copy the new line into your `.env`.

## If something goes wrong

| What you see                                                         | What to do                                                                                                                                                    |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Set POSTGRES_PASSWORD in the .env file`                             | Step 3 was skipped, or `.env` is not in the project folder.                                                                                                   |
| `port is already allocated` for 3000 or 5433                         | Another program uses that port. Close it, or change the left-hand number of the port in `compose.yaml` (for example `"127.0.0.1:3001:3000"`).                 |
| Sign-in says the email or password is not correct                    | The administrator is created only on the very first start. If you changed `.env` after that, the old values still apply. Reset with `docker compose down -v`. |
| `password authentication failed` in the `api` lines                  | `POSTGRES_PASSWORD` was changed after the first start. The database keeps its first password. Reset with `docker compose down -v`.                            |
| The page says the API service is not reachable                       | The `api` container is still starting or has stopped. Look at its lines in the terminal for the reason.                                                       |
| `BOOTSTRAP_ADMIN_PASSWORD must be at least 12 characters`            | Use a longer password in `.env`.                                                                                                                              |
| _The server has no SECRETS_KEY_ when registering the SAP API sandbox | Add `SECRETS_KEY` to `.env` as described in step 3, then stop and start again.                                                                                |
| You forgot your own administrator password                           | Another administrator can set a new one under **Users**. If you are the only one, reset with `docker compose down -v` (this deletes all data).                |

## Run the automated tests (optional)

This needs Node.js 22 from <https://nodejs.org>. With the database running (step 4):

```bash
corepack enable
pnpm install
pnpm test
```

All tests should pass. They use a separate database called `ewm_test` and never touch your data.
