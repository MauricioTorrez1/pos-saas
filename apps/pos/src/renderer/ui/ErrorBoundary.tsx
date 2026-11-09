import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  readonly children: ReactNode;
}

interface ErrorBoundaryState {
  readonly hasFailed: boolean;
}

/**
 * A safety net for the whole screen. If any part of it fails while drawing, a blank window would leave the cashier
 * guessing, so it says what happened and what is safe instead. A sale is saved before it is charged, so a failure here
 * never loses one (ADR 0010).
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { hasFailed: false };

  /** @returns the state that shows the message instead of the screen */
  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasFailed: true };
  }

  /**
   * Keeps the error where support can read it.
   *
   * @param error what failed
   * @param info where in the screen it failed
   */
  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('The register screen failed', error, info.componentStack);
  }

  /** @returns the screen, or the message if it failed */
  override render(): ReactNode {
    if (this.state.hasFailed) {
      return (
        <main className="login">
          <section className="login-card">
            <h1>Algo falló en la pantalla</h1>
            <p>Tus ventas están guardadas. Cierra la caja y ábrela otra vez. Si vuelve a pasar, avísale a soporte.</p>
          </section>
        </main>
      );
    }
    return this.props.children;
  }
}
