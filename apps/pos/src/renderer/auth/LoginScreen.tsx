import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactElement } from 'react';

import { MAX_USER_NAME_LENGTH, type UserSummary } from '../../shared/auth';
import { formatCents } from '@pos-saas/money';

import { captureDayLabel, type CaptureDayRequest, type PastCaptureDay } from '../../shared/capture-day';
import type { AuthState, PosApi } from '../../shared/pos-api';
import { CheckField } from '../ui/form-parts';

const ROLE_LABELS = { owner: 'Dueño', cashier: 'Cajero' } as const;
const PIN_HELP = 'El PIN lleva de 4 a 8 números.';
const SAVE_FAILED = 'No se pudo completar. Intenta de nuevo y, si sigue fallando, reinicia la caja.';
const LOCK_TIME = new Intl.DateTimeFormat('es-MX', { timeStyle: 'short' });
const OPENED_AT = new Intl.DateTimeFormat('es-MX', { timeStyle: 'short' });

interface LoginScreenProps {
  readonly posApi: PosApi;
  readonly authState: AuthState;
  /** Called with the person who signed in. */
  readonly onSignedIn: (user: UserSummary) => void;
}

/**
 * Where a person enters the register with their PIN, or where the first one becomes the owner. Nothing else on the screen
 * works until then, and the main process refuses sales from a screen that skipped it (RF-009, ADR 0029).
 *
 * @param props.posApi bridge to the main process
 * @param props.authState who can sign in
 * @param props.onSignedIn called once a person is signed in
 * @returns the screen
 */
export function LoginScreen({ posApi, authState, onSignedIn }: LoginScreenProps): ReactElement {
  return (
    <main className="login">
      <section className="login-card" aria-labelledby="login-title">
        {authState.needsSetup ? (
          <OwnerSetup posApi={posApi} onSignedIn={onSignedIn} />
        ) : (
          <SignIn
            posApi={posApi}
            users={authState.users}
            captureDays={authState.captureDays ?? []}
            pastDays={authState.pastDays ?? []}
            onSignedIn={onSignedIn}
          />
        )}
      </section>
    </main>
  );
}

interface SignInProps {
  readonly posApi: PosApi;
  readonly users: readonly UserSummary[];
  /** The days a session may capture, today first (E1-60). With one or none, the screen does not ask. */
  readonly captureDays: readonly string[];
  /** How each past day stands: its unfinished session and its cuts (E1-61). */
  readonly pastDays: readonly PastCaptureDay[];
  readonly onSignedIn: (user: UserSummary) => void;
}

/** What choosing a day does, said on its option so the cashier sees it before choosing (E1-61). */
function dayOptionLabel(day: string, index: number, state: PastCaptureDay | undefined): string {
  const name = index === 0 ? `Hoy, ${captureDayLabel(day)}` : index === 1 ? `Ayer, ${captureDayLabel(day)}` : captureDayLabel(day);
  if (state?.unfinished != null) {
    return `${name} · caja sin corte`;
  }
  return state !== undefined && state.cutCount > 0 ? `${name} · ya tiene corte` : name;
}

function SignIn({ posApi, users, captureDays, pastDays, onSignedIn }: SignInProps): ReactElement {
  const [selectedId, setSelectedId] = useState(users[0]?.id ?? '');
  const [pin, setPin] = useState('');
  const today = captureDays[0] ?? '';
  const [captureDay, setCaptureDay] = useState(today);
  const [ownerPin, setOwnerPin] = useState('');
  const [supplementary, setSupplementary] = useState(false);
  const isPastDay = captureDay !== today;
  const dayState = isPastDay ? pastDays.find(({ day }) => day === captureDay) : undefined;
  const unfinished = dayState?.unfinished ?? null;
  const isCutDay = dayState !== undefined && unfinished === null && dayState.cutCount > 0;
  const unfinishedElsewhere = pastDays.filter((state) => state.unfinished !== null && state.day !== captureDay);
  const needsOwnerPin = isPastDay && users.find(({ id }) => id === selectedId)?.role !== 'owner';
  const [message, setMessage] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const pinRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    pinRef.current?.focus();
  }, []);

  const move = (offset: 1 | -1): void => {
    const position = users.findIndex(({ id }) => id === selectedId);
    const next = users[(position + offset + users.length) % users.length];
    if (next !== undefined) {
      setSelectedId(next.id);
      setMessage(null);
    }
  };

  const handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      move(event.key === 'ArrowDown' ? 1 : -1);
    }
  };

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (isBusy || pin === '') {
      return;
    }
    setIsBusy(true);
    try {
      const capture: CaptureDayRequest | undefined = isPastDay
        ? { day: captureDay, ...(needsOwnerPin ? { ownerPin } : {}), ...(isCutDay && supplementary ? { supplementary: true } : {}) }
        : undefined;
      const result = await posApi.login({ userId: selectedId, pin, ...(capture === undefined ? {} : { capture }) });
      if (result.status === 'ok') {
        onSignedIn(result.user);
        return;
      }
      setPin('');
      setOwnerPin('');
      pinRef.current?.focus();
      setMessage(describeRefusal(result));
    } catch {
      setMessage(SAVE_FAILED);
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <form onSubmit={(event) => void submit(event)} onKeyDown={handleKeyDown}>
      <h1 id="login-title">¿Quién cobra?</h1>
      <div className="login-users" role="radiogroup" aria-label="Personas">
        {users.map((user) => (
          <label key={user.id} className="login-user" data-selected={user.id === selectedId}>
            <input
              className="visually-hidden"
              type="radio"
              name="user"
              value={user.id}
              checked={user.id === selectedId}
              onChange={() => {
                setSelectedId(user.id);
                setMessage(null);
                pinRef.current?.focus();
              }}
            />
            <span className="login-user-name">{user.name}</span>
            <span className="login-user-role">{ROLE_LABELS[user.role]}</span>
          </label>
        ))}
      </div>
      <label className="text-field">
        <span>PIN</span>
        <input
          ref={pinRef}
          aria-label="PIN"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          maxLength={8}
          value={pin}
          onChange={(event) => setPin(event.target.value.replace(/\D/g, ''))}
        />
      </label>
      {captureDays.length > 1 && (
        <label className="text-field">
          <span>Día de captura</span>
          <select
            aria-label="Día de captura"
            value={captureDay}
            onChange={(event) => {
              setCaptureDay(event.target.value);
              setSupplementary(false);
              setMessage(null);
            }}
          >
            {captureDays.map((day, index) => (
              <option key={day} value={day}>
                {dayOptionLabel(day, index, pastDays.find((state) => state.day === day))}
              </option>
            ))}
          </select>
        </label>
      )}
      {!isPastDay && unfinishedElsewhere.length > 0 && (
        <p className="notice" role="note" aria-label="Cajas sin corte">
          {unfinishedElsewhere.length === 1 ? 'Quedó una caja sin corte' : 'Quedaron cajas sin corte'} del{' '}
          {unfinishedElsewhere.map(({ day }) => captureDayLabel(day)).join(', del ')}. Hoy se abre una caja nueva; para
          terminar la otra, elige su día en «Día de captura».
        </p>
      )}
      {isPastDay && unfinished !== null && (
        <p className="notice login-backdated" role="status">
          Vas a retomar la caja sin corte del {captureDayLabel(captureDay)} que abrió {unfinished.openedBy} a las{' '}
          {OPENED_AT.format(new Date(unfinished.openedAt))} con un fondo de {formatCents(unfinished.openingFloatCents)}. Las ventas
          que agregues cuentan en ese día y quedan a tu nombre; al terminar haces el corte de esa caja. Lo autoriza un dueño.
        </p>
      )}
      {isCutDay && (
        <>
          <p className="notice login-backdated" role="status">
            El {captureDayLabel(captureDay)} ya tiene corte y ese corte no se cambia. Puedes agregar una captura suplementaria: una
            caja aparte para ese día, con fondo normalmente de $0 y su propio corte, que se suma al corte original. Lo autoriza un
            dueño.
          </p>
          <CheckField label={`Agregar una captura suplementaria al ${captureDayLabel(captureDay)}`} checked={supplementary} onChange={setSupplementary} />
        </>
      )}
      {isPastDay && unfinished === null && !isCutDay && (
        <p className="notice login-backdated" role="status">
          Vas a capturar ventas atrasadas del {captureDayLabel(captureDay)}: ese día no tuvo caja, así que se abre una para él, con
          su propio fondo y corte. Cada venta de esta sesión cuenta en ese día. Lo autoriza un dueño.
        </p>
      )}
      {needsOwnerPin && (
        <label className="text-field">
          <span>PIN del dueño</span>
          <input
            aria-label="PIN del dueño"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={8}
            value={ownerPin}
            onChange={(event) => setOwnerPin(event.target.value.replace(/\D/g, ''))}
          />
        </label>
      )}
      {message !== null && (
        <p className="notice" role="alert">
          {message}
        </p>
      )}
      <button type="submit" className="button button-primary" disabled={isBusy}>
        {!isPastDay ? 'Entrar' : unfinished !== null ? 'Retomar esa caja' : 'Entrar a capturar'} <kbd>Enter</kbd>
      </button>
      <p className="login-hint">Cambia de persona con ↑ ↓.</p>
    </form>
  );
}

function describeRefusal(result: Exclude<Awaited<ReturnType<PosApi['login']>>, { status: 'ok' }>): string {
  switch (result.status) {
    case 'wrong_pin':
      return result.attemptsLeft === 0
        ? 'PIN incorrecto. Se bloqueó por unos minutos para proteger la caja.'
        : `PIN incorrecto. Te quedan ${result.attemptsLeft} ${result.attemptsLeft === 1 ? 'intento' : 'intentos'}.`;
    case 'locked':
      return `Demasiados intentos. Podrás entrar a las ${LOCK_TIME.format(new Date(result.until))}.`;
    case 'unknown_user':
      return 'Esa persona ya no está en la caja. Reinicia la caja e intenta de nuevo.';
    case 'day_out_of_range':
      return 'Ese día ya no se puede capturar. Elige uno de la lista.';
    case 'owner_pin_required':
      return 'Para capturar un día atrasado, un dueño escribe su PIN.';
    case 'owner_wrong_pin':
      return result.attemptsLeft === 0
        ? 'El PIN del dueño es incorrecto y se bloqueó por unos minutos.'
        : `El PIN del dueño es incorrecto. Le quedan ${result.attemptsLeft} ${result.attemptsLeft === 1 ? 'intento' : 'intentos'}.`;
    case 'owner_locked':
      return `El PIN del dueño está bloqueado hasta las ${LOCK_TIME.format(new Date(result.until))}.`;
    case 'day_already_cut':
      return 'Ese día ya tiene corte. Para agregarle ventas, marca «Agregar una captura suplementaria».';
  }
}

interface OwnerSetupProps {
  readonly posApi: PosApi;
  readonly onSignedIn: (user: UserSummary) => void;
}

function OwnerSetup({ posApi, onSignedIn }: OwnerSetupProps): ReactElement {
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [again, setAgain] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (isBusy) {
      return;
    }
    if (name.trim() === '') {
      setMessage('Escribe tu nombre.');
    } else if (!/^[0-9]{4,8}$/.test(pin)) {
      setMessage(PIN_HELP);
    } else if (pin !== again) {
      setMessage('Los dos PIN no son iguales. Escríbelos de nuevo.');
    } else {
      setIsBusy(true);
      try {
        const owner = await posApi.setupOwner({ name: name.trim(), pin });
        const result = await posApi.login({ userId: owner.id, pin });
        if (result.status === 'ok') {
          onSignedIn(result.user);
          return;
        }
        setMessage(SAVE_FAILED);
      } catch {
        setMessage(SAVE_FAILED);
      } finally {
        setIsBusy(false);
      }
    }
  };

  return (
    <form onSubmit={(event) => void submit(event)}>
      <h1 id="login-title">Bienvenido</h1>
      <p>Esta caja todavía no tiene dueño. Escribe tu nombre y elige un PIN: con él vas a entrar, autorizar devoluciones y agregar a tus cajeros.</p>
      <label className="text-field">
        <span>Tu nombre</span>
        <input
          aria-label="Tu nombre"
          type="text"
          autoFocus
          autoComplete="off"
          spellCheck={false}
          maxLength={MAX_USER_NAME_LENGTH}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <label className="text-field">
        <span>Elige un PIN</span>
        <input
          aria-label="Elige un PIN"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          maxLength={8}
          value={pin}
          onChange={(event) => setPin(event.target.value.replace(/\D/g, ''))}
        />
      </label>
      <label className="text-field">
        <span>Repite el PIN</span>
        <input
          aria-label="Repite el PIN"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          maxLength={8}
          value={again}
          onChange={(event) => setAgain(event.target.value.replace(/\D/g, ''))}
        />
      </label>
      <p className="login-hint">{PIN_HELP}</p>
      {message !== null && (
        <p className="notice" role="alert">
          {message}
        </p>
      )}
      <button type="submit" className="button button-primary" disabled={isBusy}>
        Crear mi usuario <kbd>Enter</kbd>
      </button>
    </form>
  );
}
