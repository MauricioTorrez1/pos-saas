# Register app

Desktop register built with Electron, React, and TypeScript, using [electron-vite](https://electron-vite.org/) on top of Vite. For now it opens a window, shows its version, keeps its local database up to date, and can run a checkout with fake devices. The sale screen and the real devices arrive in the next tasks of the [roadmap](../../docs/plan/04-roadmap.md).

Electron 45 runs on Windows 10 and later, which covers the machines of [ADR 0002](../../docs/adr/0002-caja-electron.md).

## Layout
| Path | Contents | Where it runs |
| --- | --- | --- |
| `src/main/` | Window, navigation limits, answers to the screen, and the local database | Main process, with Node |
| `src/main/hardware/` | Device interfaces, and their fakes in `fakes/` | Main process, with Node |
| `src/main/checkout/` | Checkout, which drives the devices in the order of ADR 0010 | Main process, with Node |
| `src/preload/` | The `window.pos` bridge | Sandboxed preload script |
| `src/renderer/` | React screen | Sandboxed renderer, without Node |
| `src/shared/` | Types and channel names used on both sides of the bridge | Compiled into each side |
| `e2e/` | Startup and database tests with Playwright, and the crash drill | Test runner, driving the built app |

## How the screen stays away from Node
- **Window:** `contextIsolation` and `sandbox` are on, and `nodeIntegration` is off. The startup test reads these settings from the running window and checks that `require` and `process` do not exist on the screen.
- **Bridge:** the screen can only call the functions of `PosApi`, and the main process rejects calls from any other page.
- **Foreign pages:** the window cannot navigate away from the register screen or open new windows, so the bridge is never offered to another site.
- **Injected code:** the Content Security Policy in `index.html` only allows scripts and styles from the app itself.
- **Compile time:** `tsconfig.web.json` has no Node types, so screen code that uses `process` or `node:fs` does not compile.
- **Imports:** `src/main/screen-boundary.test.ts` fails if any file in `src/renderer` or `src/shared` imports Electron or a file from `src/main` or `src/preload`, such as a device or its fake.

## Hardware
The screen never gives orders to a device. It will ask the main process for a business operation, such as "check out this sale", and the main process decides which devices to use and in what order. That way the drawer cannot open for a sale that was not saved, whatever the screen does.

| Interface | What it does | Fake | What the fake records |
| --- | --- | --- | --- |
| `PrinterProvider` | Prints a job of raw ESC/POS bytes | `RecordingPrinter` | Every byte of every job, in order |
| `CashDrawer` | Opens the drawer | `RecordingCashDrawer` | How many times it opened |
| `ScaleProvider` | Reads a weight in thousandths of a kilogram | `ScriptedScale` | Returns the weights a test placed on it |
| `CardTerminal` | Charges a card and returns only the outcome, never card data | `ScriptedCardTerminal` | Each charge, once per idempotency key |

`createFakeHardware()` builds the four fakes with one shared log, so a test can check the order of a whole sale. Each fake can fail once on purpose (`failNextWith`), the way a printer without paper or a terminal without signal would.

`SaleCheckout` follows [ADR 0010](../../docs/adr/0010-guardar-antes-de-cobrar.md): it saves the sale as pending, charges the card if there is one, marks the sale completed, opens the drawer for cash, and prints the ticket. If the sale cannot be saved, nothing is charged. A declined card leaves the sale pending, so the cashier can try another method. Once the sale is completed, a failing drawer or printer becomes a problem to show, never an error, so the screen cannot mistake a completed sale for a failed one and charge again.

For now only the tests use the fakes. The real printer and drawer arrive with E1-13 and E1-14, the manual scale with E1-08, and the manual card terminal with E1-12. The bridge gets its checkout call with the payment screen in E1-11.

## Local database
The register keeps its data in `pos.db`, in the user data folder of the app (`%APPDATA%\@pos-saas\pos` on Windows), never in the repository. `LocalStore`, in `src/main/local-store/`, is the only code that talks to SQLite, through the `node:sqlite` module that ships with Electron ([ADR 0021](../../docs/adr/0021-sqlite-de-la-caja.md)).

- **Startup:** the main process opens the database and applies pending migrations before any window opens.
- **Durability:** WAL is required, and every commit reaches the disk before it returns (`synchronous = FULL`).
- **Migrations:** each one runs in its own transaction with the new schema version, so a failure undoes it completely. To change the schema, add an entry at the end of `MIGRATIONS`. Never edit one that has shipped.
- **After a forced close:** on Windows the shared-memory file (`-shm`) stays busy for a few seconds, so opening retries for up to 15 seconds on that exact error.
- **When it cannot open:** if a migration fails or the file comes from a newer version of the app, the register shows an error box, opens no window, and exits with code 1.

The tests never touch the real database, because each run gets a temporary user data folder.

## Commands
Run them from the repository root. The first time, Electron downloads its binary, about 150 MiB.

Build and open the register:

```bash
pnpm --filter @pos-saas/pos start
```

Open it with hot reload for development:

```bash
pnpm --filter @pos-saas/pos dev
```

Type-check, and run the Vitest tests and the Playwright startup test. The startup test opens real windows for a few seconds:

```bash
pnpm --filter @pos-saas/pos typecheck
```

```bash
pnpm --filter @pos-saas/pos test
```

Run the crash drill. The register opens and saves test sales to a temporary database, and the terminal prints the command to kill it. After the forced close, the drill reopens the register and reports whether any confirmed sale was lost:

```bash
pnpm --filter @pos-saas/pos crash-drill
```

## Continuous integration
The `TypeScript` job runs these tests on Linux with a virtual display (`xvfb-run`). It also lifts the Ubuntu 24.04 restriction on user namespaces, so the tests run with the sandbox of Electron on rather than with `--no-sandbox`.
