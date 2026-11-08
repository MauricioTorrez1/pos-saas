import {
  createTemporaryUserData,
  launchRegister,
  readConfirmedSales,
  readMainPid,
  readRecoveredState,
  removeTemporaryUserData,
  startWritingTestSales,
  testSalePaths,
  waitForExit,
  type RecoveredState,
} from './register-harness.ts';

const PROGRESS_INTERVAL_MS = 1_000;

/** A person closes the app by force while it writes, and this drill checks that nothing was lost. */
async function runDrill(): Promise<boolean> {
  const userDataDir = createTemporaryUserData();
  const paths = testSalePaths(userDataDir);
  try {
    const register = await launchRegister(userDataDir);
    await register.firstWindow();
    await startWritingTestSales(register, paths);
    console.log('The register is open, saving test sales to a temporary database. Your real database is not touched.');
    console.log('Force it to close from another terminal:\n');
    console.log(`  Stop-Process -Id ${await readMainPid(register)} -Force\n`);

    const progress = setInterval(() => console.log(`Confirmed sales: ${readConfirmedSales(paths)}`), PROGRESS_INTERVAL_MS);
    const exitCode = await waitForExit(register.process());
    clearInterval(progress);
    if (exitCode === 0) {
      console.log('\nThe register closed normally, which proves nothing. Run the drill again and force it to close.');
      return false;
    }

    const confirmedSales = readConfirmedSales(paths);
    console.log(`\nForced close detected (exit code ${exitCode}). Opening the register again...`);
    const reopened = await launchRegister(userDataDir);
    await reopened.firstWindow();
    const state = await readRecoveredState(reopened, paths);
    await reopened.close();
    return reportResult(confirmedSales, state);
  } finally {
    await removeTemporaryUserData(userDataDir);
  }
}

function reportResult(confirmedSales: number, state: RecoveredState): boolean {
  const lostSales = Array.from({ length: confirmedSales }, (_, index) => index + 1).filter((sale) => !state.salesFound.includes(sale));
  console.log(`Sales confirmed before the close: ${confirmedSales}`);
  console.log(`Sales found after reopening:      ${state.salesFound.length}`);
  console.log(`Confirmed sales lost:             ${lostSales.length}`);
  console.log(`Sales with missing lines:         ${state.incompleteSales}`);
  console.log(`Integrity check:                  ${state.integrity}`);
  console.log(`Journal mode:                     ${state.journalMode}`);

  const passed =
    confirmedSales > 0 && lostSales.length === 0 && state.incompleteSales === 0 && state.integrity === 'ok' && state.journalMode === 'wal';
  console.log(passed ? '\nResult: PASSED, nothing was lost.' : '\nResult: FAILED.');
  return passed;
}

runDrill()
  .then((passed) => {
    process.exitCode = passed ? 0 : 1;
  })
  .catch((error: unknown) => {
    console.error('The drill could not finish', error);
    process.exitCode = 1;
  });
