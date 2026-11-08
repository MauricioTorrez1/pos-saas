# Register app

Desktop register built with Electron, React, and TypeScript, using [electron-vite](https://electron-vite.org/) on top of Vite. It keeps its local database up to date and rings up a sale from the keyboard: a scan or a search by name adds a product and updates the totals with VAT. Collecting the payment and the real devices arrive in the next tasks of the [roadmap](../../docs/plan/04-roadmap.md).

Electron 45 runs on Windows 10 and later, which covers the machines of [ADR 0002](../../docs/adr/0002-caja-electron.md).

## Layout
| Path | Contents | Where it runs |
| --- | --- | --- |
| `src/main/` | Window, navigation limits, answers to the screen, and the local database | Main process, with Node |
| `src/main/hardware/` | Device interfaces, and their fakes in `fakes/` | Main process, with Node |
| `src/main/checkout/` | Checkout, which drives the devices in the order of ADR 0010 | Main process, with Node |
| `src/preload/` | The `window.pos` bridge | Sandboxed preload script |
| `src/renderer/` | React screen | Sandboxed renderer, without Node |
| `src/renderer/sale/` | Sale screen: lookup box, lines, totals, and scanner detection | Sandboxed renderer, without Node |
| `src/renderer/appearance/` | Dialog where the owner changes how the register looks | Sandboxed renderer, without Node |
| `src/shared/` | Types and channel names used on both sides of the bridge | Compiled into each side |
| `e2e/` | Startup, database, and sale tests with Playwright, and the crash drill | Test runner, driving the built app |

## How the screen stays away from Node
- **Window:** `contextIsolation` and `sandbox` are on, and `nodeIntegration` is off. The startup test reads these settings from the running window and checks that `require` and `process` do not exist on the screen.
- **Bridge:** the screen can only call the functions of `PosApi`, and the main process rejects calls from any other page.
- **Foreign pages:** the window cannot navigate away from the register screen or open new windows, so the bridge is never offered to another site.
- **Injected code:** the Content Security Policy in `index.html` only allows scripts and styles from the app itself.
- **Compile time:** `tsconfig.web.json` has no Node types, so screen code that uses `process` or `node:fs` does not compile.
- **Imports:** `src/main/screen-boundary.test.ts` fails if any file in `src/renderer` or `src/shared` imports Electron or a file from `src/main` or `src/preload`, such as a device or its fake.

## Sale screen
The lookup box always holds the keyboard, so a scan lands there even after a click somewhere else. The decisions behind the screen are in [ADR 0024](../../docs/adr/0024-pantalla-de-venta.md).

| Key | What it does |
| --- | --- |
| Enter | Adds the product with that exact code or, for typed text, the highlighted match |
| ↑ ↓ | Moves through the matches or, with no matches, through the lines of the sale |
| + − | Adds or takes away one unit of the selected line, when the box is empty |
| Supr | Removes the selected line, when the box is empty |
| Esc | Clears the box and the matches |
| F9 | Opens the appearance dialog |

A barcode scanner acts as a keyboard, so the register tells it apart by speed: at least 4 characters with no more than 50 ms between them. Only what happens to an unknown code changes: from the scanner it shows a warning, and from a person it searches by name.

Search runs on an FTS5 index in the local database. It matches the beginning of each word and ignores accents and capitals. With 5,000 products on the development PC, adding a scanned product took 24.5 ms at the 95th percentile, against a limit of 100 ms.

Until the real catalog arrives with F0-16, the register fills an empty catalog with sample products marked `is_sample`. Their barcodes are valid EAN-13 codes that start with 2, a range reserved for use inside a store. `2000000000107` is the first one, a hammer at $116.00.

## Appearance
F9 opens the dialog where the owner sets the business name, one of six colors, one of three text sizes, and the light or dark theme. Changes show at once and stay only when saved, and Esc undoes them. The stylesheet takes everything from a few tokens, driven by three attributes on the page, and a test checks that the text of every color and theme keeps a contrast of at least 4.5:1.

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

Measure how fast the register adds products with a catalog of 5,000. It opens the register and prints the times:

```bash
pnpm --filter @pos-saas/pos build
```

```bash
pnpm --filter @pos-saas/pos exec playwright test sale-screen -g "under 100 ms"
```

Run the crash drill. The register opens and saves test sales to a temporary database, and the terminal prints the command to kill it. After the forced close, the drill reopens the register and reports whether any confirmed sale was lost:

```bash
pnpm --filter @pos-saas/pos crash-drill
```

## Continuous integration
The `TypeScript` job runs these tests on Linux with a virtual display (`xvfb-run`). It also lifts the Ubuntu 24.04 restriction on user namespaces, so the tests run with the sandbox of Electron on rather than with `--no-sandbox`.
